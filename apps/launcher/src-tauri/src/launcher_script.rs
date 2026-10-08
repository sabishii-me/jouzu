use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

/// Runs a packaged PowerShell helper, which owns every Windows-specific detail of that component:
/// which trees are usable, which versions they report, and how a bundled archive is verified.
pub fn run(root: &Path, script: &str, arguments: &[String]) -> Result<Output, String> {
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command = Command::new(PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(root.join("runtime/launcher-update").join(script))
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
    command.output().map_err(|_| "Cannot run a launcher helper".to_string())
}

/// PowerShell puts the message the script printed first, and its own frames after it.
pub fn failure(output: &Output, fallback: &str) -> String {
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

/// Reads the path a helper printed, failing when it is not a file.
pub fn printed_path(output: &Output, message: &str) -> Result<PathBuf, String> {
    if !output.status.success() {
        return Err(failure(output, message));
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if !path.is_file() {
        return Err(message.to_string());
    }
    Ok(path)
}
