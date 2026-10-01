use std::{
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;

pub fn starter(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("starter");
    if !root.join("node/node.exe").is_file() || !root.join("bootstrap.mjs").is_file() {
        return Err("The starter application is missing. Please reinstall Jouzu Launcher.".into());
    }
    Ok(root)
}

pub fn find_bash(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(data) = app.path().app_local_data_dir() {
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
    tauri::async_runtime::spawn_blocking(move || {
        use sha2::{Digest, Sha256};
        use std::io::{Read, Write};
        let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let tools = data.join("tools");
        std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
        let destination = tools.join("git");
        if destination.exists() { return Err("Git directory already exists. Restart the launcher or select an existing Git installation.".into()); }
        let stage = tempfile::tempdir_in(&tools).map_err(|e| e.to_string())?;
        let archive = stage.path().join("PortableGit.exe");
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(300)).build().map_err(|e| e.to_string())?;
        let mut response = client.get("https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/PortableGit-2.55.0.5-64-bit.7z.exe").send().and_then(|r| r.error_for_status()).map_err(|e| format!("Git download failed: {e}"))?;
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
    let root = starter(app)?;
    let bash = find_bash(app)
        .ok_or("Git Bash is required for this preview. Select Prepare Git Bash first.")?;
    let mut command = Command::new(root.join("node/node.exe"));
    command
        .arg(root.join("console.mjs"))
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
