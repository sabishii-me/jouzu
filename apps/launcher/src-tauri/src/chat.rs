use crate::chat_transport::{encode_command, JsonlDecoder};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

const MAX_FRAME: usize = 32 * 1024 * 1024;
const MAX_BUFFER: usize = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const EXIT_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

// Root exit and pipe EOF are independent: descendants can inherit stdout, and
// stdout can close before the root's exit status becomes available.
#[derive(Default)]
struct ExitDrain {
    code: Option<u32>,
    eof: bool,
    deadline: Option<Instant>,
}
impl ExitDrain {
    fn observe_exit(&mut self, code: u32, now: Instant) {
        self.code.get_or_insert(code);
        self.deadline.get_or_insert(now + EXIT_DRAIN_TIMEOUT);
    }
    fn accepts_input(&self) -> bool {
        self.deadline.is_none()
    }
    fn read_stdout(
        &mut self,
        now: Instant,
        decoder: &mut JsonlDecoder,
        mut read: impl FnMut(&mut [u8]) -> std::io::Result<usize>,
        mut record: impl FnMut(serde_json::Map<String, Value>),
    ) -> Result<(), String> {
        if self.eof {
            return Ok(());
        }
        let mut buffer = [0; 16384];
        // This is a fairness budget, not an exit-drain budget.
        for _ in 0..16 {
            match read(&mut buffer) {
                Ok(0) => {
                    self.eof = true;
                    self.deadline.get_or_insert(now + EXIT_DRAIN_TIMEOUT);
                    break;
                }
                Ok(count) => decoder
                    .feed(&buffer[..count], &mut record)
                    .map_err(|e| e.to_string())?,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => return Err(format!("Runtime output failed: {e}")),
            }
        }
        Ok(())
    }
    fn done(&self, now: Instant) -> bool {
        (self.code.is_some() && self.eof) || self.deadline.is_some_and(|end| now >= end)
    }
    fn finish(&self, decoder: &mut JsonlDecoder, failure: &mut Option<String>) {
        if let Some(code) = self.code {
            append_error(
                failure,
                format!("Runtime exited ({code}); unfinished work was not replayed"),
            );
        }
        if self.deadline.is_some() {
            if !self.eof {
                append_error(
                    failure,
                    "Runtime stdout drain incomplete; output may be incomplete".into(),
                );
            } else if self.code.is_none() {
                append_error(
                    failure,
                    "Runtime stdout closed before exit status was available; session interrupted"
                        .into(),
                );
            }
            if let Err(error) = decoder.finish() {
                append_error(failure, error.to_string());
            }
        }
    }
}
fn append_error(error: &mut Option<String>, message: String) {
    if let Some(error) = error {
        error.push_str("; ");
        error.push_str(&message);
    } else {
        *error = Some(message);
    }
}
#[derive(Default)]
struct Output {
    records: VecDeque<Value>,
    bytes: usize,
    closed: bool,
    error: Option<String>,
    cleanup_error: Option<String>,
}
struct Session {
    owner: String,
    input: mpsc::SyncSender<Vec<u8>>,
    stop: mpsc::Sender<()>,
    output: Arc<Mutex<Output>>,
    worker: Option<std::thread::JoinHandle<()>>,
}
#[derive(Default)]
pub struct ChatService {
    sessions: Mutex<HashMap<String, Session>>,
}
#[derive(Serialize)]
pub struct Poll {
    records: Vec<Value>,
    closed: bool,
    error: Option<String>,
}
impl ChatService {
    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            stop_sessions(sessions.drain().map(|(_, session)| session).collect());
        }
    }
    /// Release the runtime and its shared update lock before an installer transaction.
    /// The desktop will reconnect the chat after the update completes.
    pub fn pause(&self) {
        self.shutdown();
    }
}
impl Drop for ChatService {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            stop_sessions(sessions.drain().map(|(_, session)| session).collect());
        }
    }
}
fn join_session(session: &mut Session) -> Result<(), String> {
    if let Some(worker) = session.worker.take() {
        worker.join().map_err(|_| "Chat cleanup worker failed")?;
    }
    let output = session
        .output
        .lock()
        .map_err(|_| "Chat output unavailable")?;
    match &output.cleanup_error {
        Some(error) => Err(error.clone()),
        None => Ok(()),
    }
}
fn stop_sessions(mut sessions: Vec<Session>) {
    for session in &sessions {
        let _ = session.stop.send(());
    }
    for session in &mut sessions {
        let _ = join_session(session);
    }
}
fn validate(request: &Value) -> Result<(), String> {
    let object = request
        .as_object()
        .ok_or("Chat request must be an object")?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Missing request type")?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing request id")?;
    if id.is_empty() || id.len() > 128 {
        return Err("Invalid request id".into());
    }
    let fields: &[&str] = match kind {
        "get_state" | "get_messages" | "abort" | "clear_queue" | "new_session"
        | "get_available_models" | "get_available_thinking_levels" | "compact" | "get_session_stats" => &["type", "id"],
        "prompt" | "steer" => &["type", "id", "message", "images"],
        "switch_session" => &["type", "id", "sessionPath"],
        "export_html" => &["type", "id", "outputPath"],
        "set_model" => &["type", "id", "provider", "modelId"],
        "set_thinking_level" => &["type", "id", "level"],
        "extension_ui_response" => &["type", "id", "value", "confirmed", "cancelled"],
        _ => return Err("Unsupported desktop chat request".into()),
    };
    if object.keys().any(|key| !fields.contains(&key.as_str())) {
        return Err("Unexpected chat request field".into());
    }
    if matches!(kind, "prompt" | "steer")
        && !object
            .get("message")
            .is_some_and(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
    {
        return Err("Message must contain text".into());
    }
    if kind == "steer" && object.get("images").is_some() {
        return Err("Steering images are not supported by this desktop".into());
    }
    if matches!(kind, "prompt" | "steer") {
        if let Some(images) = object.get("images") {
            let images = images.as_array().ok_or("Images must be an array")?;
            if images.len() > 4 {
                return Err("At most four images are supported".into());
            }
            let mut total = 0usize;
            for image in images {
                let image = image.as_object().ok_or("Invalid image attachment")?;
                if image.len() != 3 || image.get("type").and_then(Value::as_str) != Some("image") {
                    return Err("Invalid image attachment fields".into());
                }
                if !matches!(
                    image.get("mimeType").and_then(Value::as_str),
                    Some("image/png" | "image/jpeg" | "image/webp" | "image/gif")
                ) {
                    return Err("Unsupported image type".into());
                }
                let data = image
                    .get("data")
                    .and_then(Value::as_str)
                    .ok_or("Missing image data")?;
                let padding = data.bytes().rev().take_while(|b| *b == b'=').count();
                if data.is_empty()
                    || data.len() % 4 != 0
                    || padding > 2
                    || !data[..data.len() - padding]
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
                {
                    return Err("Invalid base64 image data".into());
                }
                total = total
                    .checked_add(data.len() / 4 * 3 - padding)
                    .ok_or("Image limit exceeded")?;
                let image_bytes = data.len() / 4 * 3 - padding;
                if image_bytes > MAX_IMAGE_BYTES {
                    return Err("Each image must be 10 MiB or less".into());
                }
                if total > MAX_TOTAL_IMAGE_BYTES {
                    return Err("Images must total 20 MiB or less".into());
                }
            }
        }
    }
    if kind == "switch_session" {
        let path = object
            .get("sessionPath")
            .and_then(Value::as_str)
            .ok_or("Missing session path")?;
        if path.contains('\0') || path.len() > 32767 || !std::path::Path::new(path).is_absolute() {
            return Err("Session path must be an absolute file path".into());
        }
    }
    if kind == "export_html" {
        let path = object
            .get("outputPath")
            .and_then(Value::as_str)
            .ok_or("Missing export path")?;
        if path.contains('\0') || path.len() > 32767 || !std::path::Path::new(path).is_absolute() {
            return Err("Export path must be an absolute file path".into());
        }
    }
    if kind == "set_model" {
        for key in ["provider", "modelId"] {
            let value = object
                .get(key)
                .and_then(Value::as_str)
                .ok_or("Missing model identity")?;
            if value.is_empty() || value.len() > 256 || value.contains('\0') {
                return Err("Invalid model identity".into());
            }
        }
    }
    if kind == "set_thinking_level" {
        let level = object
            .get("level")
            .and_then(Value::as_str)
            .ok_or("Missing thinking level")?;
        if level.is_empty() || level.len() > 64 || level.contains('\0') {
            return Err("Invalid thinking level".into());
        }
    }
    if kind == "extension_ui_response" {
        for key in ["confirmed", "cancelled"] {
            if object.get(key).is_some_and(|v| !v.is_boolean()) {
                return Err("Invalid extension response".into());
            }
        }
        if object.get("value").is_some_and(|v| !v.is_string()) {
            return Err("Invalid extension response value".into());
        }
    }
    Ok(())
}
fn usable_environment_name(name: &std::ffi::OsStr) -> bool {
    // Windows exposes hidden per-drive variables such as `=C:` through vars_os. They are
    // not valid child environment names and are irrelevant to the runtime.
    let text = name.to_string_lossy();
    !text.is_empty() && !text.contains('=') && !text.contains('\0')
}
#[tauri::command]
pub fn chat_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<ChatService>,
    path: String,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Chat is restricted to the main window".into());
    }
    // A webview reload does not run the previous page's React cleanup, so its chat
    // process can survive with a Flow attachment. The desktop owns exactly one chat
    // view; retire any previous process before starting the next one.
    let stale: Vec<Session> = {
        let mut previous = state
            .sessions
            .lock()
            .map_err(|_| "Chat state unavailable")?;
        previous.drain().map(|(_, session)| session).collect()
    };
    stop_sessions(stale);
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Chat state unavailable")?;
    if sessions.len() >= 8 {
        return Err("Close a conversation before starting another".into());
    }
    let cwd = std::fs::canonicalize(&path).map_err(|_| "Workspace folder is unavailable")?;
    if !cwd.is_dir() {
        return Err("Workspace must be a folder".into());
    }
    let root = crate::runtime::application_root(&app)?;
    let managed = crate::runtime::managed_root()?;
    let lease = crate::update_lock::lock(&managed, false)?;
    let slot = crate::active_app::resolve_app(&root, &managed)?;
    let bash = crate::git_environment::find(&root)?;
    let mut environment: HashMap<String, (std::ffi::OsString, std::ffi::OsString)> =
        std::env::vars_os()
            .filter(|(key, _)| usable_environment_name(key))
            .map(|(key, value)| (key.to_string_lossy().to_ascii_uppercase(), (key, value)))
            .collect();
    for entry in crate::environment::environment_read()? {
        if entry.enabled {
            environment.insert(
                entry.name.to_ascii_uppercase(),
                (entry.name.into(), entry.value.into()),
            );
        }
    }
    for name in ["NODE_OPTIONS", "NODE_PATH"] {
        environment.remove(name);
    }
    for (name, value) in [
        (
            "JOUZU_HOME",
            crate::runtime::effective_home()?.into_os_string(),
        ),
        ("JOUZU_LAUNCHER_BASH", bash.into_os_string()),
        ("JOUZU_NO_UPDATE", "1".into()),
        ("PI_SKIP_VERSION_CHECK", "1".into()),
    ] {
        environment.insert(name.into(), (name.into(), value));
    }
    let args = vec![
        crate::node_path::node_path(&slot.join("bootstrap.mjs")).into_os_string(),
        "--mode".into(),
        "rpc".into(),
    ];
    let mut process = crate::chat_process::ChatProcess::spawn(
        &root.join("runtime/node/node.exe"),
        &args,
        &cwd,
        &environment.into_values().collect::<Vec<_>>(),
        lease,
    )
    .map_err(|e| format!("Could not start chat: {e}"))?;
    static NEXT_HANDLE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let handle = format!(
        "chat-{}",
        NEXT_HANDLE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let (input, receive) = mpsc::sync_channel::<Vec<u8>>(8);
    let (stop, stopping) = mpsc::channel();
    let output = Arc::new(Mutex::new(Output::default()));
    let worker_output = output.clone();
    let worker = std::thread::spawn(move || {
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        let mut buffer = [0u8; 16384];
        let mut pending: Option<(Vec<u8>, usize, Instant)> = None;
        let mut failure = None;
        let mut drain = ExitDrain::default();
        let mut receive = Some(receive);
        'run: loop {
            if stopping.try_recv().is_ok() {
                break;
            }
            match process.try_wait() {
                Ok(Some(code)) => drain.observe_exit(code, Instant::now()),
                Ok(None) => {}
                Err(e) => {
                    failure = Some(e.to_string());
                    break;
                }
            }
            if !drain.accepts_input() {
                receive.take();
                pending = None;
                // The protocol defines stdin EOF as an orderly shutdown request.
                process.close_stdin();
            }
            if pending.is_none() {
                if let Some(Ok(bytes)) = receive.as_ref().map(|receiver| receiver.try_recv()) {
                    pending = Some((bytes, 0, Instant::now()));
                }
            }
            if let Some((bytes, offset, start)) = &mut pending {
                if start.elapsed() > Duration::from_secs(15) {
                    failure = Some("Runtime input stalled; outcome uncertain".into());
                    break;
                }
                match process.write_stdin(&bytes[*offset..]) {
                    Ok(count) => {
                        *offset += count;
                        if *offset == bytes.len() {
                            pending = None;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => match process.try_wait() {
                        Ok(Some(code)) => {
                            drain.observe_exit(code, Instant::now());
                            receive.take();
                            pending = None;
                        }
                        _ => {
                            failure = Some(format!("Runtime input failed: {e}"));
                            break;
                        }
                    },
                }
            }
            let mut overflow = false;
            let result = drain.read_stdout(
                Instant::now(),
                &mut decoder,
                |buffer| process.read_stdout(buffer),
                |record| {
                    if let Ok(mut output) = worker_output.lock() {
                        let value = Value::Object(record);
                        let size = serde_json::to_vec(&value).map_or(MAX_BUFFER + 1, |v| v.len());
                        if output.bytes + size > MAX_BUFFER || output.records.len() >= 2048 {
                            overflow = true;
                            return;
                        }
                        output.bytes += size;
                        output.records.push_back(value);
                    } else {
                        overflow = true;
                    }
                },
            );
            if let Err(error) = result {
                failure = Some(error);
                break 'run;
            }
            if overflow {
                failure = Some(
                    "Chat output exceeded the desktop buffer; session interrupted without replay"
                        .into(),
                );
                break 'run;
            }
            // Drain diagnostics without storing/logging potentially secret-bearing contents.
            for _ in 0..16 {
                match process.read_stderr(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            if drain.done(Instant::now()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        drain.finish(&mut decoder, &mut failure);
        let cleanup_error = process
            .stop()
            .err()
            .map(|error| format!("Runtime cleanup failed: {error}"));
        if let Some(error) = &cleanup_error {
            append_error(&mut failure, error.clone());
        }
        if let Ok(mut output) = worker_output.lock() {
            output.closed = true;
            output.error = failure;
            output.cleanup_error = cleanup_error;
        }
    });
    sessions.insert(
        handle.clone(),
        Session {
            owner: window.label().into(),
            input,
            stop,
            output,
            worker: Some(worker),
        },
    );
    Ok(handle)
}
#[tauri::command]
pub fn chat_send(
    window: tauri::WebviewWindow,
    state: tauri::State<ChatService>,
    handle: String,
    request: Value,
) -> Result<(), String> {
    validate(&request)?;
    let frame = encode_command(&request, 32 * 1024 * 1024).map_err(|e| e.to_string())?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Chat state unavailable")?;
    let session = sessions
        .get(&handle)
        .filter(|s| s.owner == window.label())
        .ok_or("Unknown chat connection")?;
    session
        .input
        .try_send(frame)
        .map_err(|_| "Chat input is busy or disconnected; request was not queued".into())
}
#[tauri::command]
pub fn chat_poll(
    window: tauri::WebviewWindow,
    state: tauri::State<ChatService>,
    handle: String,
) -> Result<Poll, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Chat state unavailable")?;
    let session = sessions
        .get(&handle)
        .filter(|s| s.owner == window.label())
        .ok_or("Unknown chat connection")?;
    let mut output = session
        .output
        .lock()
        .map_err(|_| "Chat output unavailable")?;
    let records = output.records.drain(..).collect();
    output.bytes = 0;
    Ok(Poll {
        records,
        closed: output.closed,
        error: output.error.clone(),
    })
}
#[tauri::command]
pub fn chat_stop(
    window: tauri::WebviewWindow,
    state: tauri::State<ChatService>,
    handle: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Chat state unavailable")?;
    if let Some(session) = sessions.get(&handle) {
        if session.owner != window.label() {
            return Err("Unknown chat connection".into());
        }
    }
    if let Some(mut session) = sessions.remove(&handle) {
        let _ = session.stop.send(());
        join_session(&mut session)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_drain_keeps_final_records_after_would_block() {
        let now = Instant::now();
        let mut drain = ExitDrain::default();
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        drain
            .read_stdout(
                now,
                &mut decoder,
                |_| Err(std::io::ErrorKind::WouldBlock.into()),
                |_| panic!("no record"),
            )
            .unwrap();
        assert!(drain.accepts_input());
        drain.observe_exit(7, now);
        assert!(!drain.accepts_input());
        assert!(!drain.done(now));
        let mut wire = &b"{\"type\":\"response\"}\n{\"type\":\"agent_end\"}\n"[..];
        let mut records = Vec::new();
        drain
            .read_stdout(
                now,
                &mut decoder,
                |buffer| std::io::Read::read(&mut wire, buffer),
                |record| records.push(record),
            )
            .unwrap();
        assert_eq!(records.len(), 2);
        assert!(drain.done(now));
        let mut failure = None;
        drain.finish(&mut decoder, &mut failure);
        assert!(failure.unwrap().contains("Runtime exited (7)"));
    }

    #[test]
    fn exit_drain_continues_past_sixteen_chunks() {
        let now = Instant::now();
        let mut drain = ExitDrain::default();
        drain.observe_exit(0, now);
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        let wire = format!("{{\"tail\":\"{}\"}}\n", "x".repeat(20 * 16384));
        let mut wire = wire.as_bytes();
        let mut count = 0;
        drain
            .read_stdout(
                now,
                &mut decoder,
                |buffer| std::io::Read::read(&mut wire, buffer),
                |_| count += 1,
            )
            .unwrap();
        assert_eq!(count, 0);
        assert!(!drain.done(now));
        drain
            .read_stdout(
                now,
                &mut decoder,
                |buffer| std::io::Read::read(&mut wire, buffer),
                |_| count += 1,
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(drain.done(now));
    }

    #[test]
    fn eof_before_exit_preserves_status_and_reports_truncated_frame() {
        let now = Instant::now();
        let mut drain = ExitDrain::default();
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        let mut wire = &b"{\"partial\":"[..];
        drain
            .read_stdout(
                now,
                &mut decoder,
                |buffer| std::io::Read::read(&mut wire, buffer),
                |_| panic!("partial record"),
            )
            .unwrap();
        assert!(!drain.accepts_input());
        assert!(!drain.done(now));
        drain.observe_exit(9, now + Duration::from_millis(5));
        assert!(drain.done(now));
        let mut failure = None;
        drain.finish(&mut decoder, &mut failure);
        let failure = failure.unwrap();
        assert!(failure.contains("Runtime exited (9)"));
        assert!(failure.contains("ended before LF"));
    }

    #[test]
    fn inherited_stdout_and_early_eof_have_fixed_deadlines() {
        let now = Instant::now();
        let mut drain = ExitDrain::default();
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        drain.observe_exit(3, now);
        drain.observe_exit(3, now + Duration::from_secs(1));
        drain
            .read_stdout(
                now,
                &mut decoder,
                |_| Err(std::io::ErrorKind::WouldBlock.into()),
                |_| {},
            )
            .unwrap();
        assert!(!drain.done(now + EXIT_DRAIN_TIMEOUT - Duration::from_millis(1)));
        assert!(drain.done(now + EXIT_DRAIN_TIMEOUT));
        let mut failure = None;
        drain.finish(&mut decoder, &mut failure);
        let failure = failure.unwrap();
        assert!(failure.contains("Runtime exited (3)"));
        assert!(failure.contains("drain incomplete"));
        let mut drain = ExitDrain::default();
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        drain
            .read_stdout(now, &mut decoder, |_| Ok(0), |_| {})
            .unwrap();
        assert!(drain.done(now + EXIT_DRAIN_TIMEOUT));
        let mut failure = None;
        drain.finish(&mut decoder, &mut failure);
        assert!(failure
            .unwrap()
            .contains("before exit status was available"));
    }

    fn test_session() -> (Session, mpsc::Receiver<()>) {
        let (input, _) = mpsc::sync_channel(1);
        let (stop, stopping) = mpsc::channel();
        (
            Session {
                owner: "main".into(),
                input,
                stop,
                output: Arc::new(Mutex::new(Output::default())),
                worker: None,
            },
            stopping,
        )
    }

    #[test]
    fn joining_reports_cleanup_failure_not_normal_exit() {
        let (mut session, _) = test_session();
        session.output.lock().unwrap().error = Some("Runtime exited (1)".into());
        assert!(join_session(&mut session).is_ok());
        let output = session.output.clone();
        session.worker = Some(std::thread::spawn(move || {
            output.lock().unwrap().cleanup_error = Some("lease retained".into());
        }));
        assert_eq!(join_session(&mut session), Err("lease retained".into()));
    }

    #[test]
    fn shutdown_signals_every_worker_before_joining() {
        let (mut first, first_stop) = test_session();
        let (second, second_stop) = test_session();
        let (observed, result) = mpsc::channel();
        first.worker = Some(std::thread::spawn(move || {
            first_stop.recv_timeout(Duration::from_secs(1)).unwrap();
            observed
                .send(second_stop.recv_timeout(Duration::from_secs(1)).is_ok())
                .unwrap();
        }));
        stop_sessions(vec![first, second]);
        assert!(result.recv().unwrap());
    }

    #[test]
    #[ignore = "requires an authenticated extracted release in JOUZU_CHAT_TEST_RUNTIME"]
    fn released_runtime_native_rpc_and_update_lease() {
        use std::ffi::OsString;
        let root = std::path::PathBuf::from(
            std::env::var_os("JOUZU_CHAT_TEST_RUNTIME").expect("release root"),
        );
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        #[cfg(windows)]
        let inherited = ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "PATH"];
        #[cfg(not(windows))]
        let inherited = ["PATH", "TMPDIR"];
        let mut env: Vec<(OsString, OsString)> = inherited
            .into_iter()
            .filter_map(|key| std::env::var_os(key).map(|value| (key.into(), value)))
            .collect();
        for (key, value) in [
            ("JOUZU_HOME", home.clone()),
            ("USERPROFILE", home.clone()),
            ("HOME", home.clone()),
            ("LOCALAPPDATA", home.clone()),
            ("APPDATA", home.clone()),
            ("TEMP", dir.path().to_path_buf()),
            ("TMP", dir.path().to_path_buf()),
        ] {
            env.push((key.into(), value.into_os_string()));
        }
        #[cfg(windows)]
        env.push(("JOUZU_LAUNCHER_BASH".into(), root.join("runtime/git/bin/bash.exe").into_os_string()));
        #[cfg(not(windows))]
        env.push(("JOUZU_LAUNCHER_BASH".into(), "/bin/bash".into()));
        env.push(("JOUZU_NO_UPDATE".into(), "1".into()));
        let lease = crate::update_lock::lock(dir.path(), false).unwrap();
        let mut process = crate::chat_process::ChatProcess::spawn(
            &root.join("runtime/node/node.exe"),
            &[
                root.join("app/bootstrap.mjs").into_os_string(),
                "--mode".into(),
                "rpc".into(),
            ],
            dir.path(),
            &env,
            lease,
        )
        .unwrap();
        assert!(crate::update_lock::lock(dir.path(), true).is_err());
        let frame = encode_command(
            &serde_json::json!({"type":"get_state","id":"native-smoke"}),
            1024,
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(45);
        let mut offset = 0;
        let mut decoder = JsonlDecoder::new(MAX_FRAME);
        let mut found = false;
        let mut buffer = [0; 8192];
        while !found {
            assert!(
                Instant::now() < deadline,
                "released RPC handshake timed out"
            );
            if offset < frame.len() {
                match process.write_stdin(&frame[offset..]) {
                    Ok(n) => offset += n,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => panic!("{e}"),
                }
            }
            match process.read_stdout(&mut buffer) {
                Ok(0) => panic!("released runtime closed stdout before handshake"),
                Ok(n) => decoder
                    .feed(&buffer[..n], |record| {
                        if record.get("id").and_then(Value::as_str) == Some("native-smoke") {
                            assert_eq!(record.get("success"), Some(&Value::Bool(true)));
                            found = true;
                        }
                    })
                    .unwrap(),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => panic!("{e}"),
            }
            let _ = process.read_stderr(&mut buffer);
            std::thread::sleep(Duration::from_millis(5));
        }
        process.stop().unwrap();
        assert!(crate::update_lock::lock(dir.path(), true).is_ok());
    }
    #[test]
    fn environment_filter_drops_windows_drive_pseudo_variables() {
        assert!(usable_environment_name(std::ffi::OsStr::new("PATH")));
        assert!(usable_environment_name(std::ffi::OsStr::new("JOUZU_HOME")));
        assert!(!usable_environment_name(std::ffi::OsStr::new("=C:")));
        assert!(!usable_environment_name(std::ffi::OsStr::new("")));
        assert!(!usable_environment_name(std::ffi::OsStr::new("A=B")));
    }
    #[test]
    fn image_payloads_are_typed_and_bounded() {
        let image = serde_json::json!({"type":"image","mimeType":"image/png","data":"aGVsbG8="});
        let prompt = |images: Value| serde_json::json!({"type":"prompt","id":"image","message":"Inspect","images":images});
        assert!(validate(&prompt(serde_json::json!([image.clone()]))).is_ok());
        assert!(validate(&prompt(serde_json::json!(vec![image.clone(); 5]))).is_err());
        for data in ["", "abc", "a===", "a b=", "abcd====", "éé"] {
            let mut invalid = image.clone();
            invalid["data"] = data.into();
            assert!(validate(&prompt(serde_json::json!([invalid]))).is_err());
        }
        let mut oversized = image.clone();
        oversized["data"] = "AAAA".repeat(4_000_000).into();
        assert!(validate(&prompt(serde_json::json!([oversized]))).is_err());
        let mut ordinary = image.clone();
        ordinary["data"] = "AAAA".repeat(700_000).into();
        assert!(validate(&prompt(serde_json::json!([ordinary]))).is_ok());
        let mut invalid = image;
        invalid["mimeType"] = "image/svg+xml".into();
        assert!(validate(&prompt(serde_json::json!([invalid]))).is_err());
    }
    #[test]
    fn session_switch_requires_explicit_absolute_path() {
        for path in ["relative.jsonl", "", "bad\0path"] {
            assert!(validate(
                &serde_json::json!({"type":"switch_session","id":"s","sessionPath":path})
            )
            .is_err());
        }
        let path = std::env::temp_dir().join("session.jsonl");
        assert!(validate(
            &serde_json::json!({"type":"switch_session","id":"s","sessionPath":path})
        )
        .is_ok());
    }
    #[test]
    fn compaction_and_export_validate_paths() {
        assert!(validate(&serde_json::json!({"type":"compact","id":"c"})).is_ok());
        for path in ["relative.html", "", "bad\0path"] {
            assert!(validate(
                &serde_json::json!({"type":"export_html","id":"e","outputPath":path})
            )
            .is_err());
        }
        let path = std::env::temp_dir().join("conversation.html");
        assert!(validate(
            &serde_json::json!({"type":"export_html","id":"e","outputPath":path})
        )
        .is_ok());
        assert!(validate(
            &serde_json::json!({"type":"export_html","id":"e","outputPath":"C:\\chat.html","extra":true})
        )
        .is_err());
    }
    #[test]
    fn request_boundary_rejects_unknown_fields_and_commands() {
        for value in [
            serde_json::json!({"type":"bash","id":"1","command":"echo unsafe"}),
            serde_json::json!({"type":"prompt","id":"1","message":"ok","cwd":"elsewhere"}),
            serde_json::json!({"type":"prompt","id":"1","message":""}),
            serde_json::json!({"type":"abort"}),
        ] {
            assert!(validate(&value).is_err());
        }
        assert!(validate(&serde_json::json!({"type":"prompt","id":"1","message":"hi"})).is_ok());
        assert!(validate(&serde_json::json!({"type":"get_session_stats","id":"1"})).is_ok());
        assert!(validate(
            &serde_json::json!({"type":"extension_ui_response","id":"a","cancelled":true})
        )
        .is_ok());
    }
}
