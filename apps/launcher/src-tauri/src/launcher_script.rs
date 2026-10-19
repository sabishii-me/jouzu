use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

/// Runs a packaged PowerShell helper, which owns every Windows-specific detail of that component:
/// which trees are usable, which versions they report, and how a bundled archive is verified.
pub fn run(root: &Path, script: &str, arguments: &[String]) -> Result<Output, String> {
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command =
        Command::new(PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    // Windows PowerShell must resolve its own modules. A caller started from PowerShell 7
    // carries that version's module path, where Windows PowerShell's Security module fails
    // to load; removing it lets the helper use its default module path.
    command.env_remove("PSModulePath");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
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
    command
        .output()
        .map_err(|_| "Cannot run a launcher helper".to_string())
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    static ENVIRONMENT: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// A caller started from PowerShell 7 carries a module path Windows PowerShell cannot use.
    /// Helpers that need a Windows PowerShell module must still run.
    #[test]
    fn helpers_load_windows_powershell_modules_despite_the_callers_module_path() {
        let _guard = ENVIRONMENT.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("runtime/launcher-update");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("probe.ps1"),
            "(Get-Command Get-AuthenticodeSignature).Name",
        )
        .unwrap();
        let previous = std::env::var_os("PSModulePath");
        std::env::set_var("PSModulePath", r"C:\does-not-exist");
        let output = run(root.path(), "probe.ps1", &[]);
        match previous {
            Some(value) => std::env::set_var("PSModulePath", value),
            None => std::env::remove_var("PSModulePath"),
        }
        let output = output.unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "Get-AuthenticodeSignature"
        );
    }
}
