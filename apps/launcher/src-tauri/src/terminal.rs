use std::{path::PathBuf, path::Path};

use crate::launcher_script;

const SCRIPT: &str = "terminal-environment.ps1";

/// The Windows Terminal that should host the console: the copy installed on this PC when it exists,
/// otherwise the bundled one. Nothing here means the standard console host.
pub fn host(root: &Path) -> Option<PathBuf> {
    let output = launcher_script::run(root, SCRIPT, &[]).ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.is_file().then_some(path)
}

/// What the interface shows: which copies exist, which one is used, and whether the archive is here.
pub fn report(root: &Path) -> Result<serde_json::Value, String> {
    let output = launcher_script::run(root, SCRIPT, &["-Report".to_string()])?;
    if !output.status.success() {
        return Err(launcher_script::failure(&output, "Cannot read the Windows Terminal state"));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid Windows Terminal state".to_string())
}

/// Installs the bundled Windows Terminal: the shipped archive when it is present, otherwise the
/// pinned release from the terminal repository, verified by digest before extraction.
pub fn install(root: &Path) -> Result<PathBuf, String> {
    let output = launcher_script::run(root, SCRIPT, &["-Install".to_string()])?;
    launcher_script::printed_path(&output, "Windows Terminal installation failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_without_the_helper_reports_no_host_instead_of_panicking() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(host(directory.path()), None);
    }
}
