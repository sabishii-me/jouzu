use std::path::{Path, PathBuf};

/// Runs the Git Bash helper through the shared runner.
fn helper_with(root: &Path, arguments: &[String]) -> Result<std::process::Output, String> {
    crate::launcher_script::run(root, "git-environment.ps1", arguments)
}

/// What the interface needs: which sources exist, their versions, which one is chosen and which one
/// would be used. Nothing here uses a system Git on its own.
pub fn report(root: &Path) -> Result<serde_json::Value, String> {
    let output = helper_with(root, &["-Report".to_string()])?;
    if !output.status.success() {
        return Err(crate::launcher_script::failure(&output, "Cannot read the Git Bash state"));
    }
    let mut value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_| "Invalid Git Bash state")?;
    // Jouzu's own copies first, then the one this PC has, so a machine with its own Git Bash keeps
    // working while the copy the launcher is qualified against stays the one it installs.
    value["effective"] = if !value["bundled"].is_null() {
        value["bundled"].clone()
    } else if !value["managed"].is_null() {
        value["managed"].clone()
    } else {
        value["system"].clone()
    };
    Ok(value)
}

/// The bash to launch Jouzu with. Fails instead of silently using a system Git.
pub fn find(root: &Path) -> Result<PathBuf, String> {
    let output = helper_with(root, &[])?;
    if !output.status.success() {
        return Err(crate::launcher_script::failure(&output, "Git Bash is unavailable. Install it from the launcher."));
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
        return Err(crate::launcher_script::failure(&output, "Git Bash installation failed"));
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if !path.is_file() {
        return Err("Git Bash installation did not produce a usable path".into());
    }
    Ok(path)
}
