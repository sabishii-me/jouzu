use crate::runtime;
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[tauri::command]
pub async fn control_request(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = runtime::application_root(&app)?;
        let script = include_str!("../../../../packaging/launcher/control.mjs");
        let mut command = Command::new(root.join("runtime/node/node.exe"));
        command
            .arg("--input-type=module")
            .arg("--eval")
            .arg(script)
            .arg("--")
            .arg(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let home = runtime::effective_home()?;
        command.env("JOUZU_HOME", home);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Cannot start configuration service".to_string())?;
        let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or("Configuration input unavailable")?
            .write_all(&bytes)
            .map_err(|_| "Cannot send configuration request".to_string())?;
        let output = child
            .wait_with_output()
            .map_err(|_| "Configuration service failed".to_string())?;
        let result: serde_json::Value = serde_json::from_slice(&output.stdout)
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
