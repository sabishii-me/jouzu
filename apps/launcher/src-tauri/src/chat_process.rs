//! Windows child-tree ownership. The lease is released only after confirmed tree exit
//! and pipe closure. Abrupt launcher death is weaker: Windows closes the lease while
//! KILL_ON_JOB_CLOSE termination may still be completing asynchronously.
#![cfg(windows)]

use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io,
    mem::{forget, size_of},
    os::windows::ffi::OsStrExt,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::*,
        Security::SECURITY_ATTRIBUTES,
        Storage::FileSystem::*,
        System::{JobObjects::*, Pipes::*, Threading::*},
    },
};

fn win(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error(error.code().0 & 0xffff)
}
fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut result: Vec<_> = value.encode_wide().collect();
    if result.contains(&0) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "embedded NUL"));
    }
    result.push(0);
    Ok(result)
}
// Microsoft CRT / CommandLineToArgvW quoting; never invoke a shell implicitly.
fn quote(value: &OsStr) -> io::Result<Vec<u16>> {
    let value = wide(value)?;
    let mut result = vec![34];
    let mut slashes = 0;
    for &c in &value[..value.len() - 1] {
        if c == 92 {
            slashes += 1;
            continue;
        }
        result.extend(std::iter::repeat_n(
            92,
            if c == 34 { slashes * 2 + 1 } else { slashes },
        ));
        slashes = 0;
        result.push(c);
    }
    result.extend(std::iter::repeat_n(92, slashes * 2));
    result.push(34);
    Ok(result)
}
struct Handle(HANDLE);
// Handles are uniquely owned; methods serialize access via &mut ChatProcess.
unsafe impl Send for Handle {}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

struct Attributes {
    storage: Vec<usize>,
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Attributes {
    fn new(handles: &[HANDLE]) -> io::Result<Self> {
        unsafe {
            let mut bytes = 0;
            let _ = InitializeProcThreadAttributeList(None, 1, None, &mut bytes);
            let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            let list = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr().cast());
            InitializeProcThreadAttributeList(Some(list), 1, None, &mut bytes).map_err(win)?;
            let result = Self { storage, list };
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                Some(handles.as_ptr().cast()),
                std::mem::size_of_val(handles),
                None,
                None,
            )
            .map_err(win)?;
            Ok(result)
        }
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.list);
        }
        let _ = &self.storage;
    }
}

static PIPE_ID: AtomicU64 = AtomicU64::new(0);
// Only the server (launcher) end is nonblocking. Child ends use ordinary blocking IO.
fn pipe(input: bool) -> io::Result<(Handle, Handle)> {
    unsafe {
        let name = wide(OsStr::new(&format!(
            r"\\.\pipe\jouzu-chat-{}-{}",
            std::process::id(),
            PIPE_ID.fetch_add(1, Ordering::Relaxed)
        )))?;
        let server = CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            (if input {
                PIPE_ACCESS_OUTBOUND
            } else {
                PIPE_ACCESS_INBOUND
            }) | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            65536,
            65536,
            0,
            None,
        );
        if server == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let server = Handle(server);
        let security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            bInheritHandle: true.into(),
            ..Default::default()
        };
        let client = Handle(
            CreateFileW(
                PCWSTR(name.as_ptr()),
                if input {
                    GENERIC_READ.0
                } else {
                    GENERIC_WRITE.0
                },
                FILE_SHARE_MODE(0),
                Some(&security),
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
            .map_err(win)?,
        );
        Ok((server, client))
    }
}

struct Owned {
    job: Handle,
    process: Option<Handle>,
    assigned: bool,
    stdin: Option<Handle>,
    stdout: Option<Handle>,
    stderr: Option<Handle>,
    lease: Option<File>,
}
impl Owned {
    fn cleanup(&mut self, timeout: Duration) -> io::Result<()> {
        unsafe {
            if self.lease.is_none() {
                return Ok(());
            }
            if self.assigned && self.stdin.is_some() {
                // The protocol defines stdin EOF as an orderly shutdown request.
                // Give the runtime a bounded moment to dispose its session, then
                // terminate whatever remains of the tree below.
                self.stdin.take();
                if let Some(process) = self.process.as_ref() {
                    WaitForSingleObject(process.0, 500);
                }
            }
            if let Some(process) = &self.process {
                if !self.assigned && WaitForSingleObject(process.0, 0) != WAIT_OBJECT_0 {
                    TerminateProcess(process.0, 1).map_err(win)?;
                }
            }
            // Job accounting can reach zero before process handles are signaled.
            // Retain handles for current members across termination as an additional
            // kernel teardown barrier, not merely an active-process count check.
            let mut capacity = 64usize;
            let members = loop {
                let mut storage = vec![0usize; capacity + 2];
                let query = QueryInformationJobObject(
                    Some(self.job.0),
                    JobObjectBasicProcessIdList,
                    storage.as_mut_ptr().cast(),
                    (storage.len() * size_of::<usize>()) as u32,
                    None,
                );
                if let Err(error) = query {
                    if error.code() == ERROR_MORE_DATA.to_hresult() && capacity < 1_048_576 {
                        capacity *= 2;
                        continue;
                    }
                    return Err(win(error));
                }
                let list = &*(storage.as_ptr() as *const JOBOBJECT_BASIC_PROCESS_ID_LIST);
                let ids = std::slice::from_raw_parts(
                    list.ProcessIdList.as_ptr(),
                    list.NumberOfProcessIdsInList as usize,
                );
                let mut members = Vec::new();
                for &pid in ids {
                    match OpenProcess(PROCESS_SYNCHRONIZE, false, pid as u32) {
                        Ok(handle) => members.push(Handle(handle)),
                        Err(error) if error.code() == ERROR_INVALID_PARAMETER.to_hresult() => (),
                        Err(error) => return Err(win(error)),
                    }
                }
                break members;
            };
            TerminateJobObject(self.job.0, 1).map_err(win)?;
            let deadline = Instant::now() + timeout;
            loop {
                let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
                QueryInformationJobObject(
                    Some(self.job.0),
                    JobObjectBasicAccountingInformation,
                    (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    None,
                )
                .map_err(win)?;
                let root_done = self
                    .process
                    .as_ref()
                    .is_none_or(|p| WaitForSingleObject(p.0, 0) == WAIT_OBJECT_0);
                if info.ActiveProcesses == 0
                    && root_done
                    && members
                        .iter()
                        .all(|p| WaitForSingleObject(p.0, 0) == WAIT_OBJECT_0)
                {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "child tree termination not confirmed; runtime lease retained",
                    ));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            self.stdin.take();
            self.stdout.take();
            self.stderr.take();
            self.process.take();
            self.lease.take();
            Ok(())
        }
    }
}

pub struct ChatProcess {
    owned: Option<Owned>,
}
impl ChatProcess {
    /// Environment entries completely replace the launcher environment.
    pub fn spawn(
        application: &Path,
        args: &[OsString],
        cwd: &Path,
        env: &[(OsString, OsString)],
        lease: File,
    ) -> io::Result<Self> {
        if !application.is_absolute() || !cwd.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "application and cwd must be absolute",
            ));
        }
        unsafe {
            let application_w = wide(application.as_os_str())?;
            let cwd_w = wide(cwd.as_os_str())?;
            let mut command = quote(application.as_os_str())?;
            for arg in args {
                command.push(32);
                command.extend(quote(arg)?);
            }
            command.push(0);
            if command.len() > 32767 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "command line too long",
                ));
            }
            let mut vars: Vec<(OsString, OsString)> = Vec::new();
            for (key, value) in env {
                let key_w = wide(key)?;
                wide(value)?;
                if key_w.len() == 1 || key_w[..key_w.len() - 1].contains(&61) {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "invalid environment name",
                    ));
                }
                vars.retain(|(k, _)| {
                    k.to_string_lossy().to_uppercase() != key.to_string_lossy().to_uppercase()
                });
                vars.push((key.clone(), value.clone()));
            }
            vars.sort_by_key(|(key, _)| key.to_string_lossy().to_uppercase());
            let mut environment = Vec::new();
            for (key, value) in vars {
                let mut entry = key;
                entry.push("=");
                entry.push(value);
                environment.extend(wide(&entry)?);
            }
            environment.push(0);
            if environment.len() == 1 {
                environment.push(0);
            }
            let job = Handle(CreateJobObjectW(None, PCWSTR::null()).map_err(win)?);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(win)?;
            let (stdin, child_in) = pipe(true)?;
            let (stdout, child_out) = pipe(false)?;
            let (stderr, child_err) = pipe(false)?;
            let handles = [child_in.0, child_out.0, child_err.0];
            let attributes = Attributes::new(&handles)?;
            let mut startup = STARTUPINFOEXW::default();
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = child_in.0;
            startup.StartupInfo.hStdOutput = child_out.0;
            startup.StartupInfo.hStdError = child_err.0;
            startup.lpAttributeList = attributes.list;
            let mut result = Self {
                owned: Some(Owned {
                    job,
                    process: None,
                    assigned: false,
                    stdin: Some(stdin),
                    stdout: Some(stdout),
                    stderr: Some(stderr),
                    lease: Some(lease),
                }),
            };
            let owned = result.owned.as_mut().unwrap();
            let mut info = PROCESS_INFORMATION::default();
            CreateProcessW(
                PCWSTR(application_w.as_ptr()),
                Some(PWSTR(command.as_mut_ptr())),
                None,
                None,
                true,
                CREATE_SUSPENDED
                    | CREATE_NO_WINDOW
                    | CREATE_UNICODE_ENVIRONMENT
                    | EXTENDED_STARTUPINFO_PRESENT,
                Some(environment.as_ptr().cast()),
                PCWSTR(cwd_w.as_ptr()),
                &startup.StartupInfo,
                &mut info,
            )
            .map_err(win)?;
            owned.process = Some(Handle(info.hProcess));
            let thread = Handle(info.hThread);
            // No user code can run until assignment succeeds. On any error Drop kills
            // the still-suspended root and retains the lease if exit cannot be proved.
            AssignProcessToJobObject(owned.job.0, info.hProcess).map_err(win)?;
            owned.assigned = true;
            if ResumeThread(thread.0) == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            Ok(result)
        }
    }
    pub fn read_stdout(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        read_pipe(self.owned.as_ref().and_then(|o| o.stdout.as_ref()), buffer)
    }
    pub fn read_stderr(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        read_pipe(self.owned.as_ref().and_then(|o| o.stderr.as_ref()), buffer)
    }
    /// Writes at most 64 KiB; a full pipe returns WouldBlock, never waits for the child.
    pub fn write_stdin(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let handle = self
            .owned
            .as_ref()
            .and_then(|o| o.stdin.as_ref())
            .ok_or_else(|| io::Error::from(io::ErrorKind::BrokenPipe))?;
        if buffer.is_empty() {
            return Ok(0);
        }
        let mut written = 0;
        unsafe {
            WriteFile(
                handle.0,
                Some(&buffer[..buffer.len().min(65536)]),
                Some(&mut written),
                None,
            )
            .map_err(win)?;
        }
        if written == 0 {
            Err(io::ErrorKind::WouldBlock.into())
        } else {
            Ok(written as usize)
        }
    }
    pub fn close_stdin(&mut self) {
        if let Some(owned) = &mut self.owned {
            owned.stdin.take();
        }
    }
    /// Root exit is not tree exit and never releases the lease.
    pub fn try_wait(&mut self) -> io::Result<Option<u32>> {
        unsafe {
            let Some(process) = self.owned.as_ref().and_then(|o| o.process.as_ref()) else {
                return Ok(None);
            };
            match WaitForSingleObject(process.0, 0) {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut code = 0;
                    GetExitCodeProcess(process.0, &mut code).map_err(win)?;
                    Ok(Some(code))
                }
                _ => Err(io::Error::last_os_error()),
            }
        }
    }
    pub fn stop(&mut self) -> io::Result<()> {
        self.owned
            .as_mut()
            .map_or(Ok(()), |o| o.cleanup(Duration::from_secs(3)))
    }
}
impl Drop for ChatProcess {
    fn drop(&mut self) {
        if self.stop().is_err() {
            // Fail closed: never permit runtime replacement while a child may live.
            // Leak ownership until launcher exit rather than releasing its lease.
            if let Some(owned) = self.owned.take() {
                forget(owned);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt};

    fn lease(path: &Path) -> File {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(0)
            .open(path)
            .unwrap()
    }
    fn available(path: &Path) -> bool {
        OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(path)
            .is_ok()
    }
    fn system(relative: &str) -> std::path::PathBuf {
        Path::new(&std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join(relative)
    }
    fn drain(process: &mut ChatProcess) -> (String, String) {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut out = Vec::new();
        let mut err = Vec::new();
        let mut done = [false; 2];
        while !done.iter().all(|v| *v) {
            assert!(
                Instant::now() < deadline,
                "fixture output deadline exceeded"
            );
            for i in 0..2 {
                if done[i] {
                    continue;
                }
                let mut buffer = [0u8; 4096];
                let result = if i == 0 {
                    process.read_stdout(&mut buffer)
                } else {
                    process.read_stderr(&mut buffer)
                };
                match result {
                    Ok(0) => done[i] = true,
                    Ok(n) => {
                        if i == 0 {
                            out.extend_from_slice(&buffer[..n]);
                        } else {
                            err.extend_from_slice(&buffer[..n]);
                        }
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => (),
                    Err(e) => panic!("fixture read: {e}"),
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        (
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }
    #[test]
    fn quotes_native_arguments_and_preserves_environment_cwd_and_exit() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fixture with spaces.js");
        std::fs::write(&script, "for(var i=0;i<WScript.Arguments.length;i++)WScript.Echo('['+WScript.Arguments(i)+']');var s=new ActiveXObject('WScript.Shell');WScript.Echo(s.Environment('PROCESS')('JOUZU_CHAT_TEST'));WScript.Echo(s.CurrentDirectory);WScript.StdErr.WriteLine('stderr-marker');WScript.Quit(23);").unwrap();
        let samples = ["", "plain", "two words", "&|<>^%"];
        let mut args = vec![
            OsString::from("//E:JScript"),
            OsString::from("//nologo"),
            script.into_os_string(),
        ];
        args.extend(samples.iter().map(OsString::from));
        let lock = dir.path().join("lease");
        let mut child = ChatProcess::spawn(
            &system("cscript.exe"),
            &args,
            dir.path(),
            &[("JOUZU_CHAT_TEST".into(), "overlay works".into())],
            lease(&lock),
        )
        .unwrap();
        let (out, err) = drain(&mut child);
        let lines: Vec<_> = out.lines().collect();
        for (i, sample) in samples.iter().enumerate() {
            assert_eq!(lines[i], format!("[{sample}]"));
        }
        assert_eq!(lines[samples.len()], "overlay works");
        assert_eq!(Path::new(lines[samples.len() + 1]), dir.path());
        assert_eq!(err.trim(), "stderr-marker");
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(child.try_wait().unwrap(), Some(23));
        assert!(!available(&lock), "root exit must retain lease");
        child.stop().unwrap();
        child.stop().unwrap();
        assert!(available(&lock));
    }
    #[test]
    fn stdin_is_bounded_nonblocking_and_close_is_eof() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("sleep.js");
        std::fs::write(&script, "WScript.Sleep(30000);").unwrap();
        let unrelated_path = dir.path().join("unrelated");
        let unrelated = lease(&unrelated_path);
        use std::os::windows::io::AsRawHandle;
        unsafe {
            SetHandleInformation(
                HANDLE(unrelated.as_raw_handle()),
                HANDLE_FLAG_INHERIT.0,
                HANDLE_FLAG_INHERIT,
            )
            .unwrap();
        }
        let mut child = ChatProcess::spawn(
            &system("cscript.exe"),
            &[
                "//E:JScript".into(),
                "//nologo".into(),
                script.into_os_string(),
            ],
            dir.path(),
            &[],
            lease(&dir.path().join("lease")),
        )
        .unwrap();
        // Inherited handles keep their numeric value. Inspect this child rather
        // than global file sharing: unrelated concurrent legacy Command spawns
        // may inherit the deliberately inheritable sentinel during this test.
        unsafe {
            let sentinel = HANDLE(unrelated.as_raw_handle());
            SetHandleInformation(sentinel, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)).unwrap();
            let process = child.owned.as_ref().unwrap().process.as_ref().unwrap().0;
            let mut duplicate = HANDLE::default();
            match DuplicateHandle(
                process,
                sentinel,
                GetCurrentProcess(),
                &mut duplicate,
                0,
                false,
                DUPLICATE_SAME_ACCESS,
            ) {
                Ok(()) => {
                    let duplicate = Handle(duplicate);
                    assert!(
                        !CompareObjectHandles(sentinel, duplicate.0).as_bool(),
                        "unrelated inheritable handle escaped allowlist"
                    );
                }
                Err(error) => assert_eq!(error.code(), ERROR_INVALID_HANDLE.to_hresult()),
            }
        }
        drop(unrelated);
        let start = Instant::now();
        let buffer = vec![42; 1024 * 1024];
        let mut blocked = false;
        for _ in 0..32 {
            match child.write_stdin(&buffer) {
                Ok(n) => assert!(n > 0 && n <= 65536),
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                    blocked = true;
                    break;
                }
                Err(e) => panic!("write: {e}"),
            }
        }
        assert!(blocked);
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(
            child.read_stdout(&mut [0; 1]).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        child.close_stdin();
        assert_eq!(
            child.write_stdin(b"x").unwrap_err().kind(),
            io::ErrorKind::BrokenPipe
        );
        child.stop().unwrap();
        let script = dir.path().join("eof.js");
        std::fs::write(&script, "WScript.Echo(WScript.StdIn.ReadAll());").unwrap();
        let mut child = ChatProcess::spawn(
            &system("cscript.exe"),
            &[
                "//E:JScript".into(),
                "//nologo".into(),
                script.into_os_string(),
            ],
            dir.path(),
            &[],
            lease(&dir.path().join("lease")),
        )
        .unwrap();
        assert_eq!(child.write_stdin(b"hello").unwrap(), 5);
        child.close_stdin();
        assert_eq!(drain(&mut child).0.trim(), "hello");
        child.stop().unwrap();
    }
    #[test]
    fn drop_kills_descendant_after_root_exit_before_releasing_lease() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("tree.js");
        std::fs::write(&script, "var p=new ActiveXObject('WScript.Shell').Exec('ping.exe -n 60 127.0.0.1');WScript.Echo(p.ProcessID);").unwrap();
        let lock = dir.path().join("lease");
        let mut child = ChatProcess::spawn(
            &system("cscript.exe"),
            &[
                "//E:JScript".into(),
                "//nologo".into(),
                script.into_os_string(),
            ],
            dir.path(),
            &[],
            lease(&lock),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut out = Vec::new();
        while !out.contains(&b'\n') {
            assert!(Instant::now() < deadline);
            let mut bytes = [0; 128];
            match child.read_stdout(&mut bytes) {
                Ok(n) if n > 0 => out.extend_from_slice(&bytes[..n]),
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => (),
                other => panic!("missing descendant pid: {other:?}"),
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let pid: u32 = String::from_utf8(out).unwrap().trim().parse().unwrap();
        let descendant = Handle(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).unwrap() });
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.0, 0) },
            WAIT_TIMEOUT
        );
        let root_deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().unwrap().is_none() {
            assert!(
                Instant::now() < root_deadline,
                "root must exit while descendant lives"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!available(&lock));
        drop(child);
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.0, 0) },
            WAIT_OBJECT_0
        );
        assert!(available(&lock));
    }
    #[test]
    fn quote_roundtrips_windows_argument_parser() {
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn CommandLineToArgvW(command: *const u16, count: *mut i32) -> *mut *mut u16;
        }
        let samples = ["", "two words", "a\"b", "tail\\", "a\\\"b", "雪", "&|<>^%"];
        let mut command = quote(OsStr::new("fixture.exe")).unwrap();
        for sample in samples {
            command.push(32);
            command.extend(quote(OsStr::new(sample)).unwrap());
        }
        command.push(0);
        unsafe {
            let mut count = 0;
            let argv = CommandLineToArgvW(command.as_ptr(), &mut count);
            assert!(!argv.is_null());
            assert_eq!(count as usize, samples.len() + 1);
            for (i, sample) in samples.iter().enumerate() {
                let ptr = *argv.add(i + 1);
                let mut length = 0;
                while *ptr.add(length) != 0 {
                    length += 1;
                }
                assert_eq!(
                    String::from_utf16(std::slice::from_raw_parts(ptr, length)).unwrap(),
                    *sample
                );
            }
            LocalFree(Some(HLOCAL(argv.cast())));
        }
    }
    #[test]
    fn invalid_spawn_releases_lease_without_executing() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("lease");
        assert!(ChatProcess::spawn(
            &dir.path().join("missing.exe"),
            &[],
            dir.path(),
            &[],
            lease(&lock)
        )
        .is_err());
        assert!(available(&lock));
        assert!(ChatProcess::spawn(
            &system("cscript.exe"),
            &[OsString::from("a\0b")],
            dir.path(),
            &[],
            lease(&lock)
        )
        .is_err());
        assert!(available(&lock));
    }
}

fn read_pipe(handle: Option<&Handle>, buffer: &mut [u8]) -> io::Result<usize> {
    if buffer.is_empty() {
        return Ok(0);
    }
    let Some(handle) = handle else {
        return Ok(0);
    };
    let mut read = 0;
    match unsafe { ReadFile(handle.0, Some(buffer), Some(&mut read), None) } {
        Ok(()) => Ok(read as usize),
        Err(error) if error.code() == ERROR_NO_DATA.to_hresult() => {
            Err(io::ErrorKind::WouldBlock.into())
        }
        Err(error) if error.code() == ERROR_BROKEN_PIPE.to_hresult() => Ok(0),
        Err(error) => Err(win(error)),
    }
}
