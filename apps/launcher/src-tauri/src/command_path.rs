//! The terminal command entry. The value lives in the user environment, so the script that owns it
//! reads and changes it; the launcher only asks and reports.

use crate::launcher_script;
use std::path::{Path, PathBuf};

const SCRIPT: &str = "command-path.ps1";

/// The per-user directory the shim files live in, under the same root as the rest of the installation.
pub fn directory(managed: &Path) -> PathBuf {
    managed.join("bin")
}

fn ask(root: &Path, managed: &Path, action: &str, write: bool) -> Result<serde_json::Value, String> {
    let mut arguments = vec![
        "-Directory".to_string(),
        directory(managed).to_string_lossy().into_owned(),
        "-Action".to_string(),
        action.to_string(),
    ];
    if write {
        arguments.push("-Write".to_string());
    }
    let output = launcher_script::run(root, SCRIPT, &arguments)?;
    if !output.status.success() {
        return Err(launcher_script::failure(
            &output,
            "Cannot read the terminal command state",
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid terminal command state".to_string())
}

/// Where the entry stands, and what a shell started now would run.
pub fn report(root: &Path, managed: &Path) -> Result<serde_json::Value, String> {
    ask(root, managed, "Report", false)
}

/// The authorized action: Jouzu's entry answers before the command it supersedes.
pub fn use_jouzu(root: &Path, managed: &Path) -> Result<serde_json::Value, String> {
    ask(root, managed, "Precedence", true)
}

/// Put the previous resolution back: the entry returns to the end, where it shadows nothing.
pub fn restore(root: &Path, managed: &Path) -> Result<serde_json::Value, String> {
    ask(root, managed, "Restore", true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_directory_sits_under_the_managed_root() {
        assert_eq!(
            directory(Path::new("C:/managed")),
            PathBuf::from("C:/managed/bin")
        );
    }
}
