use std::{path::{Path, PathBuf}, process::Command};

pub fn find(root: &Path) -> Result<PathBuf, String> {
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command = Command::new(PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(root.join("runtime/launcher-update/git-environment.ps1"))
        .arg("-InstallRoot").arg(root);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let output = command.output().map_err(|_| "Cannot detect Git Bash")?;
    if !output.status.success() { return Err("Git Bash is unavailable. Repair the Jouzu installation.".into()); }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if !path.is_file() { return Err("Git Bash detection returned an invalid path".into()); }
    Ok(path)
}
