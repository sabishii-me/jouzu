use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub fn managed_root() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("JOUZU_LAUNCHER_DEV_HOME") {
        return Ok(PathBuf::from(root));
    }
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
    Ok(PathBuf::from(local).join("Shisa.ai").join("Jouzu"))
}

pub fn effective_home() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("JOUZU_LAUNCHER_DEV_HOME").is_some() {
        return Ok(managed_root()?.join("data"));
    }
    if let Some(home) = std::env::var_os("JOUZU_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(home));
    }
    Ok(managed_root()?.join("data"))
}

pub fn install_root_for_executable(executable: &Path) -> Result<PathBuf, String> {
    executable
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Executable has no parent directory".into())
}

pub fn application_root(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let root = install_root_for_executable(&executable)?;
    #[cfg(debug_assertions)]
    let root = std::env::var_os("JOUZU_LAUNCHER_DEV_RUNTIME")
        .map(PathBuf::from)
        .unwrap_or(root);
    if !root.join("runtime/node/node.exe").is_file() || !root.join("app/bootstrap.mjs").is_file() {
        return Err("Jouzu application files are missing. Please repair the installation.".into());
    }
    Ok(root)
}

pub fn find_bash(app: &tauri::AppHandle) -> Option<PathBuf> {
    application_root(app).ok().and_then(|root| crate::git_environment::find(&root).ok())
}

pub fn launch(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if !Path::new(path).is_dir() {
        return Err("This folder is unavailable. Choose another folder.".into());
    }
    let root = application_root(app)?;
    let bash = find_bash(app)
        .ok_or("Git Bash is missing. Repair the Jouzu installation.")?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut command = Command::new(executable.with_file_name("console.exe"));
    command.env("JOUZU_HOME", effective_home()?);
    crate::environment::apply(&mut command)?;
    command
        .arg(&root)
        .arg(managed_root()?)
        .current_dir(path)
        .env("JOUZU_LAUNCHER_BASH", bash);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000010);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Jouzu: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod path_tests {
    use super::*;
    #[test]
    fn program_location_follows_executable_not_default_data_root() {
        let directory = std::env::temp_dir().join("custom Jouzu install");
        assert_eq!(
            install_root_for_executable(&directory.join("launcher.exe")).unwrap(),
            directory
        );
    }
}
