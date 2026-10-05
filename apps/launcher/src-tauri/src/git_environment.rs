use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn helper(root: &Path) -> PathBuf {
    root.join("runtime/launcher-update/git-environment.ps1")
}

/// Runs the Git Bash helper, which owns every Windows-specific detail: which trees are signed and
/// runnable, which versions they report, and how the bundled archive is verified.
fn helper_with(root: &Path, arguments: &[String]) -> Result<Output, String> {
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command = Command::new(PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(helper(root))
        .arg("-InstallRoot")
        .arg(root);
    for argument in arguments {
        command.arg(argument);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.output().map_err(|_| "Cannot run the Git Bash helper".to_string())
}

/// The stored choice: Jouzu's own Git Bash, or one the user picked from this machine.
pub fn choice(managed: &Path) -> serde_json::Value {
    std::fs::read(managed.join("git-provider.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or(serde_json::Value::Null)
}

pub fn set_choice(managed: &Path, value: serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    std::fs::write(managed.join("git-provider.json"), bytes).map_err(|_| "Cannot record the Git Bash choice".to_string())
}

fn preferred(managed: &Path) -> Option<String> {
    let choice = choice(managed);
    if choice.get("provider").and_then(|value| value.as_str()) != Some("system") {
        return None;
    }
    choice.get("path").and_then(|value| value.as_str()).map(str::to_string)
}

/// What the interface needs: which sources exist, their versions, which one is chosen and which one
/// would be used. Nothing here uses a system Git on its own.
pub fn report(root: &Path, managed: &Path) -> Result<serde_json::Value, String> {
    let output = helper_with(root, &["-Report".to_string()])?;
    if !output.status.success() {
        return Err(failure(&output, "Cannot read the Git Bash state"));
    }
    let mut value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_| "Invalid Git Bash state")?;
    let provider = choice(managed).get("provider").and_then(|item| item.as_str()).unwrap_or("bundled").to_string();
    let effective = match provider.as_str() {
        "system" if !value["preferred"].is_null() => value["preferred"].clone(),
        _ if !value["bundled"].is_null() => value["bundled"].clone(),
        _ => value["managed"].clone(),
    };
    value["choice"] = serde_json::json!(provider);
    value["effective"] = effective;
    Ok(value)
}

/// The bash to launch Jouzu with. Fails instead of silently using a system Git.
pub fn find(root: &Path, managed: &Path) -> Result<PathBuf, String> {
    let mut arguments = Vec::new();
    if let Some(path) = preferred(managed) {
        arguments.push("-Preferred".to_string());
        arguments.push(path);
    }
    let output = helper_with(root, &arguments)?;
    if !output.status.success() {
        return Err(failure(&output, "Git Bash is unavailable. Install it from the launcher."));
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if !path.is_file() {
        return Err("Git Bash detection returned an invalid path".into());
    }
    Ok(path)
}

/// Installs Jouzu's Git Bash: the bundled archive when it is present, otherwise the pinned
/// git-for-windows release, verified by digest and publisher before it is extracted.
pub fn install(root: &Path) -> Result<PathBuf, String> {
    let output = helper_with(root, &["-Install".to_string()])?;
    if !output.status.success() {
        return Err(failure(&output, "Git Bash installation failed"));
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if !path.is_file() {
        return Err("Git Bash installation did not produce a usable path".into());
    }
    Ok(path)
}

/// PowerShell puts the message we wrote first and its own frames after it.
fn failure(output: &Output, fallback: &str) -> String {
    let text = String::from_utf8_lossy(&output.stderr);
    text.lines()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && !line.starts_with("At ")
                && !line.starts_with('+')
                && !line.starts_with("CategoryInfo")
                && !line.starts_with("FullyQualifiedErrorId")
        })
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stored_system_choice_is_the_only_way_a_system_git_is_used() {
        let directory = tempfile::tempdir().unwrap();
        let managed = directory.path();
        assert_eq!(preferred(managed), None);
        std::fs::write(managed.join("git-provider.json"), r#"{"provider":"bundled"}"#).unwrap();
        assert_eq!(preferred(managed), None);
        let expected = r"C:\Program Files\Git\bin\bash.exe";
        let stored = serde_json::json!({ "provider": "system", "path": expected }).to_string();
        std::fs::write(managed.join("git-provider.json"), stored).unwrap();
        assert_eq!(preferred(managed).as_deref(), Some(expected));
    }

    #[test]
    fn an_unreadable_choice_file_falls_back_to_the_bundled_git() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("git-provider.json"), "not json").unwrap();
        assert_eq!(preferred(directory.path()), None);
        assert!(choice(directory.path()).is_null());
    }
}
