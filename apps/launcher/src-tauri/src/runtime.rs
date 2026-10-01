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
    let namespace = if cfg!(feature = "update-rehearsal") { "JouzuUpdateTest" } else { "Jouzu" };
    Ok(PathBuf::from(local).join("Shisa.ai").join(namespace))
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

pub fn find_bash(_app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(data) = managed_root() {
        candidates.push(data.join("tools/git/bin/bash.exe"));
    }
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(key) {
            candidates.push(PathBuf::from(root).join("Git/bin/bash.exe"));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            if path.join("git.exe").is_file() {
                candidates.push(path.join("../bin/bash.exe"));
                candidates.push(path.join("bash.exe"));
            }
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[tauri::command]
pub async fn install_git(app: tauri::AppHandle) -> Result<(), String> {
    let bundled = application_root(&app)?.join("runtime/git/PortableGit.exe");
    tauri::async_runtime::spawn_blocking(move || {
        use sha2::{Digest, Sha256};
        use std::io::{Read, Write};
        let data = managed_root().map_err(|e| e.to_string())?;
        let tools = data.join("tools");
        std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
        let destination = tools.join("git");
        if destination.exists() { return Err("Git directory already exists. Restart the launcher or select an existing Git installation.".into()); }
        let stage = tempfile::tempdir_in(&tools).map_err(|e| e.to_string())?;
        let archive = stage.path().join("PortableGit.exe");
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(300)).build().map_err(|e| e.to_string())?;
        let mut response: Box<dyn Read> = if bundled.is_file() {
            Box::new(std::fs::File::open(&bundled).map_err(|e| e.to_string())?)
        } else { Box::new(client.get("https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/PortableGit-2.55.0.5-64-bit.7z.exe").send().and_then(|r| r.error_for_status()).map_err(|e| format!("Git download failed: {e}"))?) };
        let mut file = std::fs::File::create(&archive).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new(); let mut total = 0_u64; let mut buffer = [0_u8; 65536];
        loop {
            let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 { break; }
            total += count as u64;
            if total > 512 * 1024 * 1024 { return Err("Git download exceeded size limit".into()); }
            hash.update(&buffer[..count]); file.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
        }
        drop(file);
        if format!("{:x}", hash.finalize()) != "5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290" { return Err("Git download verification failed".into()); }
        let extracted = stage.path().join("extracted");
        let mut command = Command::new(&archive);
        command.arg("-y").arg(format!("-o{}", extracted.display()));
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let status = command.status().map_err(|e| e.to_string())?;
        if !status.success() || !extracted.join("bin/bash.exe").is_file() { return Err("Git extraction failed".into()); }
        std::fs::rename(extracted, destination).map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

pub fn launch(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if !Path::new(path).is_dir() {
        return Err("This folder is unavailable. Choose another folder.".into());
    }
    let root = application_root(app)?;
    let bash = find_bash(app)
        .ok_or("Git Bash is required for command tools. Select Prepare Git Bash first.")?;
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
