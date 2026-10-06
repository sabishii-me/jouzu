#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod active_app;
mod launcher_script;
mod terminal;
mod git_environment;
mod logs;
mod bug_report;
mod command_path;
mod managed_paths;
mod recovery;
mod node_path;
mod renderer;
mod update_lock;
mod jouzu_update;
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
/// What the System section shows about the previous run and where support material lives.
fn diagnostics() -> Result<serde_json::Value, String> {
    let managed = runtime::managed_root()?;
    Ok(serde_json::json!({
        "logs": logs::directory(&managed).to_string_lossy(),
        "crashes": logs::crash_records(&managed),
    }))
}

#[tauri::command]
fn crash_dismiss(path: String) -> Result<(), String> {
    let managed = runtime::managed_root()?;
    logs::dismiss_crash(&managed, &path)
}

#[tauri::command]
/// Build the report draft with the payload's own reporter, and answer what the Launcher knows about this
/// installation when that reporter is not there.
fn bug_report(
    app: tauri::AppHandle,
    description: String,
    expected: String,
    actual: String,
    reproduction: String,
) -> Result<serde_json::Value, String> {
    Ok(
        bug_report::draft(&app, &description, &expected, &actual, &reproduction).unwrap_or_else(|_| {
            serde_json::json!({
                "available": false,
                "title": "",
                "body": "",
                "issueUrl": bug_report::ISSUE_NEW_URL,
            })
        }),
    )
}

#[tauri::command]
/// Open a terminal in a folder with the environment this installation manages, without starting Jouzu.
/// The session itself is built by the script the installer carries, so the window, a terminal entry and
/// this button describe one environment in one place.
fn terminal_open(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    // A terminal opens in the folder the launcher already has; without one it opens in the user's home
    // rather than asking, because a terminal does not need a folder to be useful.
    let folder = path
        .filter(|value| Path::new(value).is_dir())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))
        .ok_or("Cannot find a folder to open the terminal in.")?;
    let root = runtime::application_root(&app)?;
    let managed = runtime::managed_root()?;
    let slot = active_app::resolve_app(&root, &managed)?;
    let bash = git_environment::find(&root)?;
    let host = terminal::host(&root)
        .ok_or("Windows Terminal is unavailable. Install it from the launcher.")?;
    let status = std::process::Command::new(root.join("runtime/node/node.exe"))
        .arg(root.join("runtime/launcher-update/open-terminal.mjs"))
        .arg(&slot)
        .arg(&managed)
        .arg(&host)
        .arg(&bash)
        .arg(runtime::effective_home()?)
        .arg(&folder)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err("The terminal could not be opened.".into());
    }
    Ok(())
}

#[tauri::command]
fn command_entry_report(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    command_path::report(&runtime::application_root(&app)?, &runtime::managed_root()?)
}

#[tauri::command]
fn command_entry_use(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    command_path::use_jouzu(&runtime::application_root(&app)?, &runtime::managed_root()?)
}

#[tauri::command]
fn command_entry_repair(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    command_path::repair(&runtime::application_root(&app)?, &runtime::managed_root()?)
}

#[tauri::command]
fn command_entry_remove(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    command_path::remove(&runtime::application_root(&app)?, &runtime::managed_root()?)
}

#[tauri::command]
/// The log folder is where a report's evidence lives; the folder opens, and the interface names no path.
fn open_logs(app: tauri::AppHandle) -> Result<(), String> {
    let directory = logs::directory(&runtime::managed_root()?);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(directory.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
/// The interface watches the Launcher's own update through a plugin, which no command sees, and a
/// silent check has to leave a trace somewhere, so both hand one line here.
fn log_event(message: String) -> Result<(), String> {
    logs::note(&runtime::managed_root()?, &message);
    Ok(())
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
    if let Err(error) = runtime::launch(&app, &path) {
        if let Ok(managed) = runtime::managed_root() {
            logs::append(&managed, "launcher.log", &format!("launch failed folder={path} error={error}"));
        }
        return Err(error);
    }
    if let Ok(managed) = runtime::managed_root() {
        logs::append(&managed, "launcher.log", &format!("launch folder={path}"));
    }
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
    // Component health must not disable the independent Launcher repair channel.
    let value = active_app::resolve_app(&root, &runtime::managed_root()?)
        .ok()
        .and_then(|path| std::fs::read(path.join("node_modules/jouzu/package.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or(serde_json::Value::Null);
    Ok(
        serde_json::json!({ "jouzuUpdaterConfigured": root.join("jouzu-update.json").is_file() && root.join("runtime/launcher-update/update-service.mjs").is_file(), "jouzu": value.get("version").and_then(|v| v.as_str()), "development": cfg!(debug_assertions), "launcherUpdaterConfigured": app.config().plugins.0.get("updater").map(|v| v["pubkey"].as_str().is_some_and(|s| !s.is_empty()) && v["endpoints"].as_array().is_some_and(|a| !a.is_empty())).unwrap_or(false) }),
    )
}

#[tauri::command]
fn console_repair_needed(app: tauri::AppHandle) -> Result<bool, String> {
    let root = runtime::application_root(&app)?;
    // The console is drawn by the terminal Jouzu ships, so a machine that does not have that copy yet
    // installs it before Jouzu starts, whatever terminal it already has.
    Ok(!terminal::bundled_copy(&root))
}

#[tauri::command]
fn terminal(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    terminal::report(&runtime::application_root(&app)?)
}

#[tauri::command]
async fn terminal_install(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = runtime::application_root(&app)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || terminal::install(&root)).await;
    if let Ok(managed) = runtime::managed_root() {
        let result = match &outcome {
            Ok(Ok(path)) => format!("installed {}", path.display()),
            Ok(Err(error)) => format!("failed {error}"),
            Err(_) => "failed task".to_string(),
        };
        logs::append(&managed, "launcher.log", &format!("windows terminal install {result}"));
    }
    outcome.map_err(|_| "Windows Terminal installation failed".to_string())??;
    terminal::report(&runtime::application_root(&app)?)
}

#[tauri::command]
fn git_bash(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    git_environment::report(&runtime::application_root(&app)?)
}

#[tauri::command]
async fn git_bash_install(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = runtime::application_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || git_environment::install(&root))
        .await
        .map_err(|_| "Git Bash installation failed".to_string())??;
    git_environment::report(&runtime::application_root(&app)?)
}

/// The webview loads a development server when the frontend is not embedded, and a user runs no such
/// server. `--production-build-check` reports that state through the exit code, which the packaging
/// step refuses to accept.
fn production_build_check(mut arguments: impl Iterator<Item = String>) -> Option<i32> {
    arguments
        .any(|argument| argument == "--production-build-check")
        .then(|| i32::from(tauri::is_dev()))
}

fn main() {
    if let Some(code) = production_build_check(std::env::args()) {
        std::process::exit(code);
    }
    // A panic in the Launcher would otherwise close the window and leave nothing behind.
    if let Ok(managed) = runtime::managed_root() {
        logs::install_panic_hook(managed, env!("CARGO_PKG_VERSION"));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Ok(managed) = runtime::managed_root() {
                logs::append(
                    &managed,
                    "launcher.log",
                    &format!("launcher start version={}", env!("CARGO_PKG_VERSION")),
                );
            }
            if let Ok(executable) = std::env::current_exe() {
                if let Ok(root) = runtime::install_root_for_executable(&executable) {
                    runtime::cleanup_superseded_executables(&root);
                }
            }
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
            let window = tauri::WebviewWindowBuilder::from_config(app, config)?
                .data_directory(data)
                .build()?;
            renderer::watch(&window, runtime::managed_root().ok());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launcher_state,
            launch_jouzu,
            forget_workspace,
            add_workspaces,
            component_versions,
            recovery::repair_jouzu,
            diagnostics,
            crash_dismiss,
            log_event,
            bug_report,
            terminal_open,
            open_logs,
            command_entry_report,
            command_entry_use,
            command_entry_remove,
            command_entry_repair,
            jouzu_update::jouzu_update,
            control::control_request,
            control::cancel_control,
            terminal,
            terminal_install,
            git_bash,
            git_bash_install,
            console_repair_needed,
            environment::environment_read,
            environment::environment_save,

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

#[cfg(test)]
mod build_check_tests {
    use super::production_build_check;

    fn arguments(values: &[&str]) -> std::vec::IntoIter<String> {
        values
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn the_production_build_check_reports_the_embedded_frontend() {
        assert_eq!(
            production_build_check(arguments(&["launcher.exe", "--production-build-check"])),
            Some(i32::from(tauri::is_dev()))
        );
        assert_eq!(production_build_check(arguments(&["launcher.exe"])), None);
    }
}
