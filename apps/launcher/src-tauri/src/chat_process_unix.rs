//! Unix child-tree ownership. The runtime starts in its own process group, and the
//! lease is released only after the root exits and that group is gone. Abrupt launcher
//! death is weaker than on Windows: the OS closes the lease, while the runtime may keep
//! running until it exits on its own.
#![cfg(unix)]

use std::{
    ffi::OsString,
    fs::File,
    io::{self, Read, Write},
    os::fd::{AsRawFd, RawFd},
    os::unix::{ffi::OsStrExt, process::CommandExt},
    path::Path,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// A process group survives its leader, so the check asks the kernel about the group.
fn group_alive(group: i32) -> bool {
    if group <= 0 {
        return false;
    }
    if unsafe { libc::kill(-group, 0) } == 0 {
        return true;
    }
    io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

struct Owned {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    group: i32,
    lease: Option<File>,
}

impl Owned {
    fn try_wait(&mut self) -> io::Result<Option<u32>> {
        let Some(child) = self.child.as_mut() else {
            return Ok(None);
        };
        Ok(child
            .try_wait()?
            .map(|status| status.code().unwrap_or(1) as u32))
    }

    fn cleanup(&mut self, timeout: Duration) -> io::Result<()> {
        if self.lease.is_none() {
            return Ok(());
        }
        if self.stdin.is_some() {
            // The protocol defines stdin EOF as an orderly shutdown request.
            // Give the runtime a bounded moment to dispose its session, then
            // terminate whatever remains of the tree below.
            self.stdin.take();
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                if self.try_wait()?.is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        if self.group > 0 {
            // SIGKILL matches the Windows job-object termination: once the launcher
            // decides to stop the runtime, it gets no further chance to run code.
            unsafe {
                libc::kill(-self.group, libc::SIGKILL);
            }
        }
        let deadline = Instant::now() + timeout;
        loop {
            let root_done = self.try_wait()?.is_some();
            if root_done && !group_alive(self.group) {
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
        self.child.take();
        self.lease.take();
        Ok(())
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
        for (key, _) in env {
            let bytes = key.as_bytes();
            if bytes.is_empty() || bytes.contains(&b'=') || bytes.contains(&0) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid environment name",
                ));
            }
        }
        let mut command = Command::new(application);
        command.args(args).current_dir(cwd).env_clear();
        for (key, value) in env {
            command.env(key, value);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // A dedicated group lets stop() terminate the runtime and everything it started.
        command.process_group(0);
        let mut child = command.spawn()?;
        let group = i32::try_from(child.id())
            .map_err(|_| io::Error::other("child process id out of range"))?;
        let mut process = Self {
            owned: Some(Owned {
                stdin: child.stdin.take(),
                stdout: child.stdout.take(),
                stderr: child.stderr.take(),
                child: Some(child),
                group,
                lease: Some(lease),
            }),
        };
        // Non-blocking pipes keep the supervisor loop responsive: the Windows
        // implementation never waits inside a read or write either.
        if let Err(error) = process.nonblocking_pipes() {
            let _ = process.stop();
            return Err(error);
        }
        Ok(process)
    }

    fn nonblocking_pipes(&mut self) -> io::Result<()> {
        let Some(owned) = self.owned.as_ref() else {
            return Ok(());
        };
        for fd in [
            owned.stdin.as_ref().map(AsRawFd::as_raw_fd),
            owned.stdout.as_ref().map(AsRawFd::as_raw_fd),
            owned.stderr.as_ref().map(AsRawFd::as_raw_fd),
        ]
        .into_iter()
        .flatten()
        {
            set_nonblocking(fd)?;
        }
        Ok(())
    }

    pub fn read_stdout(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self.owned.as_mut().and_then(|o| o.stdout.as_mut()) {
            Some(stdout) => stdout.read(buffer),
            None => Ok(0),
        }
    }

    pub fn read_stderr(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self.owned.as_mut().and_then(|o| o.stderr.as_mut()) {
            Some(stderr) => stderr.read(buffer),
            None => Ok(0),
        }
    }

    /// Writes at most 64 KiB; a full pipe returns WouldBlock, never waits for the child.
    pub fn write_stdin(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(stdin) = self.owned.as_mut().and_then(|o| o.stdin.as_mut()) else {
            return Err(io::ErrorKind::BrokenPipe.into());
        };
        if buffer.is_empty() {
            return Ok(0);
        }
        let written = stdin.write(&buffer[..buffer.len().min(65536)])?;
        if written == 0 {
            Err(io::ErrorKind::WouldBlock.into())
        } else {
            Ok(written)
        }
    }

    pub fn close_stdin(&mut self) {
        if let Some(owned) = &mut self.owned {
            owned.stdin.take();
        }
    }

    /// Root exit is not tree exit and never releases the lease.
    pub fn try_wait(&mut self) -> io::Result<Option<u32>> {
        self.owned.as_mut().map_or(Ok(None), Owned::try_wait)
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
                std::mem::forget(owned);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn lease(managed: &Path) -> File {
        crate::update_lock::lock(managed, false).unwrap()
    }

    fn drain(process: &mut ChatProcess) -> (String, String) {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut out = Vec::new();
        let mut err = Vec::new();
        let mut done = [false; 2];
        while !done.iter().all(|value| *value) {
            assert!(
                Instant::now() < deadline,
                "fixture output deadline exceeded"
            );
            for index in 0..2 {
                if done[index] {
                    continue;
                }
                let mut buffer = [0u8; 4096];
                let result = if index == 0 {
                    process.read_stdout(&mut buffer)
                } else {
                    process.read_stderr(&mut buffer)
                };
                match result {
                    Ok(0) => done[index] = true,
                    Ok(count) => {
                        if index == 0 {
                            out.extend_from_slice(&buffer[..count]);
                        } else {
                            err.extend_from_slice(&buffer[..count]);
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => (),
                    Err(error) => panic!("fixture read: {error}"),
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        (
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    fn wait_for_exit(process: &mut ChatProcess) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(code) = process.try_wait().unwrap() {
                return code;
            }
            assert!(Instant::now() < deadline, "fixture exit deadline exceeded");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn passes_arguments_environment_and_cwd_and_retains_the_lease() {
        let dir = tempfile::tempdir().unwrap();
        let args: Vec<OsString> = ["-c", "printf '%s\\n' \"$JOUZU_CHAT_TEST\"; /bin/pwd; printf 'stderr-marker' >&2; exit 23"]
            .iter()
            .map(OsString::from)
            .collect();
        let mut child = ChatProcess::spawn(
            Path::new("/bin/sh"),
            &args,
            dir.path(),
            &[("JOUZU_CHAT_TEST".into(), "overlay works".into())],
            lease(dir.path()),
        )
        .unwrap();
        let (out, err) = drain(&mut child);
        let lines: Vec<_> = out.lines().collect();
        assert_eq!(lines[0], "overlay works");
        assert_eq!(
            PathBuf::from(lines[1]),
            dir.path().canonicalize().unwrap()
        );
        assert_eq!(err, "stderr-marker");
        assert_eq!(wait_for_exit(&mut child), 23);
        // Root exit is not tree exit: the lease stays held until stop() proves teardown.
        assert!(crate::update_lock::lock(dir.path(), true).is_err());
        child.stop().unwrap();
        assert!(crate::update_lock::lock(dir.path(), true).is_ok());
    }

    #[test]
    fn pipes_round_trip_without_waiting_for_the_child() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = ChatProcess::spawn(
            Path::new("/bin/cat"),
            &[],
            dir.path(),
            &[],
            lease(dir.path()),
        )
        .unwrap();
        let frame = b"{\"type\":\"ping\"}\n";
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut offset = 0;
        while offset < frame.len() {
            assert!(Instant::now() < deadline);
            match child.write_stdin(&frame[offset..]) {
                Ok(count) => offset += count,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("fixture write: {error}"),
            }
        }
        let mut received = Vec::new();
        while received.len() < frame.len() {
            assert!(Instant::now() < deadline);
            let mut buffer = [0u8; 256];
            match child.read_stdout(&mut buffer) {
                Ok(0) => break,
                Ok(count) => received.extend_from_slice(&buffer[..count]),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("fixture read: {error}"),
            }
        }
        assert_eq!(received, frame);
        child.close_stdin();
        assert_eq!(wait_for_exit(&mut child), 0);
        child.stop().unwrap();
    }

    #[test]
    fn stop_terminates_a_child_that_ignores_stdin_eof() {
        let dir = tempfile::tempdir().unwrap();
        let args: Vec<OsString> = ["-c", "trap '' TERM; sleep 30"].iter().map(OsString::from).collect();
        let mut child = ChatProcess::spawn(
            Path::new("/bin/sh"),
            &args,
            dir.path(),
            &[],
            lease(dir.path()),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        child.stop().unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(crate::update_lock::lock(dir.path(), true).is_ok());
    }
}
