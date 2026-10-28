use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Output},
};

/// The module path a Windows PowerShell helper may use.
///
/// A caller can start the launcher from PowerShell 7, whose module path makes Windows
/// PowerShell load a conflicting Security module: `Get-AuthenticodeSignature` then fails with a
/// type-data conflict. Helpers need the system modules only, never the caller's.
fn system_module_path(system_root: &Path, program_files: Option<&Path>) -> Option<OsString> {
    let mut paths = Vec::new();
    if let Some(program_files) = program_files {
        paths.push(program_files.join("WindowsPowerShell/Modules"));
    }
    paths.push(system_root.join("System32/WindowsPowerShell/v1.0/Modules"));
    std::env::join_paths(paths).ok()
}

/// Builds the helper command without running it, so a test can inspect its environment.
fn helper_command(root: &Path, script: &str, arguments: &[String]) -> Result<Command, String> {
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command = Command::new(PathBuf::from(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(root.join("runtime/launcher-update").join(script))
        .arg("-InstallRoot")
        .arg(root);
    if let Some(module_path) = system_module_path(
        Path::new(&windows),
        std::env::var_os("ProgramFiles").as_deref().map(Path::new),
    ) {
        command.env("PSModulePath", module_path);
    }
    for argument in arguments {
        command.arg(argument);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

/// Runs a packaged PowerShell helper, which owns every Windows-specific detail of that component:
/// which trees are usable, which versions they report, and how a bundled archive is verified.
pub fn run(root: &Path, script: &str, arguments: &[String]) -> Result<Output, String> {
    helper_command(root, script, arguments)?
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

    #[test]
    fn helpers_get_the_system_module_path_not_the_callers() {
        let path = system_module_path(Path::new("C:\\Windows"), Some(Path::new("C:\\Program Files"))).unwrap();
        let text = path.to_string_lossy().to_lowercase().replace('/', "\\");
        assert!(text.contains("windows\\system32\\windowspowershell\\v1.0\\modules"));
        assert!(text.contains("program files\\windowspowershell\\modules"));
        assert!(!text.contains("powershell\\7"));
    }

    #[test]
    fn the_helper_command_overrides_the_callers_module_path() {
        let command = helper_command(Path::new("C:\\Jouzu"), "git-environment.ps1", &["-Report".to_string()]).unwrap();
        let module_path = command
            .get_envs()
            .find(|(key, _)| key.eq_ignore_ascii_case("PSModulePath"))
            .and_then(|(_, value)| value)
            .expect("the helper sets PSModulePath");
        let text = module_path.to_string_lossy().to_lowercase().replace('/', "\\");
        assert!(text.contains("windowspowershell\\v1.0\\modules"));
        assert!(!text.contains("powershell\\7"));
    }
}
