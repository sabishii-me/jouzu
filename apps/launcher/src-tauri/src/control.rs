use std::sync::atomic::{AtomicBool, Ordering};
static ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
struct OperationGuard;
impl Drop for OperationGuard {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::SeqCst);
    }
}
#[tauri::command]
pub fn cancel_control() {
    CANCEL.store(true, Ordering::SeqCst);
}

use crate::runtime;
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
};
use tauri::Emitter;

#[tauri::command]
pub async fn control_request(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return Err("Another configuration operation is running".into());
    }
    let guard = OperationGuard;
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lease = crate::update_lock::lock(&runtime::managed_root()?, false)?;
        let root = runtime::application_root(&app)?;
        let script = include_str!("../../../../packaging/launcher/control.mjs");
        let mut command = Command::new(root.join("runtime/node/node.exe"));
        command
            .arg("--input-type=module")
            .arg("--eval")
            .arg(script)
            .arg("--")
            .arg(&root)
            .arg(crate::node_path::node_path(&crate::active_app::resolve_app(&root, &runtime::managed_root()?)?))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let home = runtime::effective_home()?;
        command.env("JOUZU_HOME", home);
        crate::environment::apply(&mut command)?;
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Cannot start configuration service".to_string())?;
        let events = child
            .stderr
            .take()
            .ok_or("Configuration events unavailable")?;
        let event_app = app.clone();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(events).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value["type"] == "device" {
                        let _ = event_app.emit("control-device", value);
                    }
                }
            }
        });
        let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or("Configuration input unavailable")?
            .write_all(&bytes)
            .map_err(|_| "Cannot send configuration request".to_string())?;
        let mut stdout = child.stdout.take().ok_or("Configuration output unavailable")?;
        let output_reader = std::thread::spawn(move || { let mut bytes = Vec::new(); stdout.read_to_end(&mut bytes).map(|_| bytes) });
        let start = std::time::Instant::now();
        loop {
            if CANCEL.load(Ordering::SeqCst) || start.elapsed() > std::time::Duration::from_secs(190) {
                let _ = child.kill(); let _ = child.wait(); let _ = reader.join();
                return Err("Configuration operation cancelled or timed out; refresh status before retrying".into());
            }
            if child.try_wait().map_err(|_| "Cannot check configuration operation")?.is_some() { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let output = child
            .wait_with_output()
            .map_err(|_| "Configuration service failed".to_string())?;
        let _ = reader.join();
        let result: serde_json::Value = serde_json::from_slice(&output_reader.join().map_err(|_| "Configuration reader failed")?.map_err(|_| "Configuration output failed")?)
            .map_err(|_| "Invalid configuration service response".to_string())?;
        if !output.status.success() {
            return Err(result["error"]
                .as_str()
                .unwrap_or("Configuration operation failed")
                .to_string());
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
