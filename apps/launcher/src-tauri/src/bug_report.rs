//! What the Launcher knows about this installation, so a report carries facts rather than recollection.
//! The draft itself is written by the payload's own reporter; nothing here describes it.

use crate::{active_app, git_environment, logs, runtime, terminal};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

/// The last line of a log about a given subject, which is what a report should carry.
fn last_line(managed: &Path, file: &str, needle: &str) -> Option<String> {
    let text = std::fs::read_to_string(logs::directory(managed).join(file)).ok()?;
    text.lines().rev().find(|line| line.contains(needle)).map(|line| line.to_string())
}

fn payload_version(slot: &Path) -> Option<String> {
    let text = std::fs::read_to_string(slot.join("node_modules/jouzu/package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value["version"].as_str().map(str::to_string)
}

/// The facts a report carries, and the one line that describes them in the payload's environment section.
pub fn facts(root: &Path, managed: &Path, slot: &Path) -> serde_json::Value {
    let shape = if root.join("runtime/git/PortableGit.exe").is_file() { "full" } else { "launcher-only" };
    let update = last_line(managed, "launcher.log", "update").unwrap_or_else(|| "no update recorded".into());
    let session = last_line(managed, "session.log", "end exit=").unwrap_or_else(|| "no session recorded".into());
    let git = git_environment::report(root)
        .ok()
        .and_then(|report| report["effective"]["path"].as_str().map(str::to_string))
        .unwrap_or_else(|| "unavailable".into());
    let host = terminal::report(root)
        .ok()
        .and_then(|report| report["effective"].as_str().map(str::to_string))
        .unwrap_or_else(|| "standard console".into());
    let payload = payload_version(slot).unwrap_or_else(|| "unknown".into());
    let identity = format!(
        "Jouzu Launcher {} ({shape}), payload {payload}, install {}, last update: {update}, last session: {session}, Git Bash {git}, console host {host}",
        env!("CARGO_PKG_VERSION"),
        root.display()
    );
    serde_json::json!({
        "launcherVersion": env!("CARGO_PKG_VERSION"),
        "payloadVersion": payload,
        "installRoot": root.to_string_lossy(),
        "managedRoot": managed.to_string_lossy(),
        "shape": shape,
        "runtimeIdentity": identity,
    })
}

/// The draft as the payload's reporter writes it, with what the user typed and what this installation
/// knows. A release whose reporter is not there answers that instead of a draft.
pub fn draft(
    app: &tauri::AppHandle,
    description: &str,
    expected: &str,
    actual: &str,
    reproduction: &str,
) -> Result<serde_json::Value, String> {
    let root = runtime::application_root(app)?;
    let managed = runtime::managed_root()?;
    let slot = active_app::resolve_app(&root, &managed)?;
    let mut request = facts(&root, &managed, &slot);
    request["description"] = serde_json::json!(description);
    request["expected"] = serde_json::json!(expected);
    request["actual"] = serde_json::json!(actual);
    request["reproduction"] = serde_json::json!(reproduction);
    let file = managed.join("cache").join("bug-report-facts.json");
    std::fs::create_dir_all(file.parent().ok_or("Cannot write the report request")?)
        .map_err(|error| error.to_string())?;
    std::fs::write(&file, request.to_string()).map_err(|error| error.to_string())?;
    let output = Command::new(root.join("runtime/node/node.exe"))
        .arg(root.join("runtime/launcher-update/bug-report.mjs"))
        .arg(&slot)
        .arg(&file)
        .output()
        .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(&file);
    if !output.status.success() {
        return Err(crate::launcher_script::failure(&output, "Cannot build the report"));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid report draft".to_string())
}

/// Whether `gh` can post at all, so the interface offers the web form instead of a disabled action.
pub fn can_submit() -> bool {
    Command::new("gh")
        .args(["api", "user", "--hostname", "github.com", "--jq", ".login"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Post the reviewed draft with `gh`. The account is asked for first, so a machine that is not signed in
/// answers before anything is sent.
pub fn submit(title: &str, body: &str) -> Result<String, String> {
    let account = Command::new("gh")
        .args(["api", "user", "--hostname", "github.com", "--jq", ".login"])
        .output()
        .map_err(|error| error.to_string())?;
    if !account.status.success() {
        return Err("gh is not signed in. Copy the draft or open the issue form.".into());
    }
    let mut child = Command::new("gh")
        .args([
            "issue",
            "create",
            "--repo",
            "https://github.com/shisa-ai/jouzu",
            "--title",
            title,
            "--body-file",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    child
        .stdin
        .take()
        .ok_or("Cannot send the report")?
        .write_all(body.as_bytes())
        .map_err(|error| error.to_string())?;
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("The issue was not created. Check the issue list before trying again.".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
