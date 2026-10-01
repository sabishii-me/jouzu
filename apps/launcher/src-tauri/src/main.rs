#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod control;
mod environment;
mod runtime;
use serde::{Deserialize, Serialize};
use std::path::Path;

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
    bundled_git: bool,
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
    let history = runtime::managed_root()?.join("recent.json");
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
        ready: runtime::application_root(&app).is_ok(),
        bash: runtime::find_bash(&app).is_some(),
        bundled_git: runtime::application_root(&app)
            .map(|root| root.join("runtime/git/PortableGit.exe").is_file())
            .unwrap_or(false),
        recent,
    })
}

#[tauri::command]
fn launch_jouzu(app: tauri::AppHandle, path: String) -> Result<(), String> {
    runtime::launch(&app, &path)?;
    let mut state = launcher_state(app.clone())?;
    if !state.recent.iter().any(|item| item.path == path) {
        state.recent.push(Workspace {
            id: format!("{}:{}", platform(), path),
            path,
            environment: Environment {
                kind: platform().into(),
            },
        });
    }

    let data = runtime::managed_root()?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_workspaces(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    if paths.len() > 1000 {
        return Err("Too many folders in one operation".into());
    }
    let mut state = launcher_state(app)?;
    for path in &paths {
        if !Path::new(path).is_dir() {
            return Err("Only existing folders can be added".into());
        }
    }
    for path in paths {
        let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
        if state.recent.iter().any(|item| {
            std::fs::canonicalize(&item.path)
                .map(|p| p == canonical)
                .unwrap_or(item.path == path)
        }) {
            continue;
        }
        state.recent.push(Workspace {
            id: format!("{}:{}", platform(), path),
            path,
            environment: Environment {
                kind: platform().into(),
            },
        });
    }
    let data = runtime::managed_root()?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn forget_workspace(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut state = launcher_state(app)?;
    state.recent.retain(|item| item.id != id);
    let data = runtime::managed_root()?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn component_versions(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = runtime::application_root(&app)?;
    let package = root.join("app/node_modules/jouzu/package.json");
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(package).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({ "jouzu": value.get("version").and_then(|v| v.as_str()), "development": cfg!(debug_assertions), "launcherUpdaterConfigured": app.config().plugins.0.get("updater").map(|v| v["pubkey"].as_str().is_some_and(|s| !s.is_empty()) && v["endpoints"].as_array().is_some_and(|a| !a.is_empty())).unwrap_or(false) }),
    )
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data = runtime::managed_root()
                .map_err(std::io::Error::other)?
                .join("cache/webview");
            std::fs::create_dir_all(&data)?;
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("Missing window configuration")?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .data_directory(data)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launcher_state,
            launch_jouzu,
            forget_workspace,
            add_workspaces,
            component_versions,
            control::control_request,
            control::cancel_control,
            environment::environment_read,
            environment::environment_save,
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
