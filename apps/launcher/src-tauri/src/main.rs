#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
struct Environment {
    kind: &'static str,
}
#[derive(Serialize)]
struct Workspace {
    id: String,
    path: String,
    environment: Environment,
}
#[derive(Serialize)]
struct LauncherState {
    platform: &'static str,
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
        environment: Environment { kind: "windows" },
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
fn launcher_state() -> Result<LauncherState, String> {
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
    Ok(LauncherState {
        platform: platform(),
        recent,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![launcher_state])
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
