#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Manager;

#[derive(Serialize, Deserialize)]
struct Environment {
    kind: String,
}
#[derive(Serialize, Deserialize)]
struct Workspace {
    id: String,
    path: String,
    environment: Environment,
}
#[derive(Serialize, Deserialize)]
struct LauncherState {
    platform: String,
    ready: bool,
    bash: bool,
    recent: Vec<Workspace>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPreference {
    schema_version: u32,
    remember: bool,
    folder: String,
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn legacy_workspace(content: &str) -> Result<Option<Workspace>, String> {
    let preference: LegacyPreference = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Cannot read remembered folder: {error}"))?;
    if preference.schema_version != 1 {
        return Err("Unsupported folder preference version".into());
    }
    if !preference.remember || preference.folder.is_empty() {
        return Ok(None);
    }
    Ok(Some(Workspace {
        id: format!("windows:{}", preference.folder),
        path: preference.folder,
        environment: Environment {
            kind: "windows".into(),
        },
    }))
}

fn read_legacy(path: &Path) -> Result<Vec<Workspace>, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("Cannot read folder preferences: {error}")),
    };
    Ok(legacy_workspace(&content)?.into_iter().collect())
}

#[tauri::command]
fn launcher_state(app: tauri::AppHandle) -> Result<LauncherState, String> {
    let history = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("recent.json");
    let recent = if cfg!(target_os = "windows") {
        match std::env::var_os("LOCALAPPDATA") {
            Some(root) => {
                read_legacy(&Path::new(&root).join("JouzuDesktop").join("launcher.json"))?
            }
            None => vec![],
        }
    } else {
        vec![]
    };
    let recent = if history.exists() {
        serde_json::from_slice(&std::fs::read(history).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Cannot read history: {e}"))?
    } else {
        recent
    };
    Ok(LauncherState {
        platform: platform().into(),
        ready: runtime::starter(&app).is_ok(),
        bash: runtime::find_bash(&app).is_some(),
        recent,
    })
}

#[tauri::command]
fn launch_jouzu(app: tauri::AppHandle, path: String) -> Result<(), String> {
    runtime::launch(&app, &path)?;
    let mut state = launcher_state(app.clone())?;
    state.recent.retain(|item| item.path != path);
    state.recent.insert(
        0,
        Workspace {
            id: format!("{}:{}", platform(), path),
            path,
            environment: Environment {
                kind: platform().into(),
            },
        },
    );
    state.recent.truncate(20);
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            launcher_state,
            launch_jouzu,
            runtime::install_git
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Jouzu launcher");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_remembered_folder() {
        let w = legacy_workspace(r#"{"schemaVersion":1,"remember":true,"folder":"project"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(w.path, "project");
    }
    #[test]
    fn respects_forgetting() {
        assert!(
            legacy_workspace(r#"{"schemaVersion":1,"remember":false,"folder":"old"}"#)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn rejects_invalid_preferences() {
        assert!(legacy_workspace("not json").is_err());
        assert!(legacy_workspace(r#"{"schemaVersion":2,"remember":true,"folder":"x"}"#).is_err());
    }
}
