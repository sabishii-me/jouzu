use std::{path::PathBuf, path::Path};

use crate::launcher_script;

const SCRIPT: &str = "terminal-environment.ps1";

/// The copy the user chose: Jouzu's own Windows Terminal, or one this PC has.
fn choice(managed: &Path) -> serde_json::Value {
    std::fs::read(managed.join("terminal-provider.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn preferred(managed: &Path) -> Option<String> {
    let value = choice(managed);
    if value.get("provider").and_then(|item| item.as_str()) != Some("system") {
        return None;
    }
    value.get("path").and_then(|item| item.as_str()).map(str::to_string)
}

pub fn set_choice(managed: &Path, value: serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    std::fs::write(managed.join("terminal-provider.json"), bytes).map_err(|_| "Cannot record the Windows Terminal choice".to_string())
}

/// The Windows Terminal that should host the console: the chosen copy when it is there, otherwise
/// the bundled one, otherwise the one this PC has. Nothing here means the standard console host.
pub fn host(root: &Path, managed: &Path) -> Option<PathBuf> {
    let mut arguments = Vec::new();
    if let Some(path) = preferred(managed) {
        arguments.push("-Preferred".to_string());
        arguments.push(path);
    }
    let output = launcher_script::run(root, SCRIPT, &arguments).ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.is_file().then_some(path)
}

/// What the interface shows: which copies exist, which one is used, and whether the archive is here.
pub fn report(root: &Path, managed: &Path) -> Result<serde_json::Value, String> {
    let mut arguments = vec!["-Report".to_string()];
    if let Some(path) = preferred(managed) {
        arguments.push("-Preferred".to_string());
        arguments.push(path);
    }
    let output = launcher_script::run(root, SCRIPT, &arguments)?;
    if !output.status.success() {
        return Err(launcher_script::failure(&output, "Cannot read the Windows Terminal state"));
    }
    let mut value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_| "Invalid Windows Terminal state".to_string())?;
    let provider = choice(managed).get("provider").and_then(|item| item.as_str()).unwrap_or("bundled").to_string();
    // A chosen copy that cannot be used is reported, never silently replaced by another one.
    if provider == "system" && value["preferred"].is_null() {
        return Err("That Windows Terminal is no longer usable. Choose another copy.".to_string());
    }
    value["choice"] = serde_json::json!(provider);
    value["effective"] = if provider == "system" {
        value["preferred"].clone()
    } else if !value["bundled"].is_null() {
        value["bundled"]["path"].clone()
    } else {
        value["system"]["path"].clone()
    };
    Ok(value)
}

/// Installs the bundled Windows Terminal: the shipped archive when it is present, otherwise the
/// pinned release from the terminal repository, verified by digest before extraction.
pub fn install(root: &Path, managed: &Path) -> Result<PathBuf, String> {
    let output = launcher_script::run(root, SCRIPT, &["-Install".to_string()])?;
    let path = launcher_script::printed_path(&output, "Windows Terminal installation failed")?;
    // Installing the shipped copy is how a user asks for it.
    set_choice(managed, serde_json::json!({ "provider": "bundled" }))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_without_the_helper_reports_no_host_instead_of_panicking() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(host(directory.path(), directory.path()), None);
    }
}
