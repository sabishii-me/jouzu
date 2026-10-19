use serde::Serialize;
use serde_json::Value;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::time::UNIX_EPOCH;
const MAX_SESSIONS: usize = 200;
const MAX_PREFIX_BYTES: u64 = 512 * 1024;
const MAX_LINES: usize = 400;
const MAX_TITLE_CHARS: usize = 80;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    path: String,
    title: String,
    workspace: String,
    updated: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowReportRecord {
    pub kind: String,
    pub text: String,
}

#[tauri::command]
pub fn chat_sessions() -> Result<Vec<SessionSummary>, String> {
    let home = crate::runtime::effective_home()?;
    Ok(list_sessions(&home.join("state/sessions")))
}

#[tauri::command]
pub fn chat_flow_reports(session_path: String) -> Result<Vec<FlowReportRecord>, String> {
    if session_path.contains('\0') || !Path::new(&session_path).is_absolute() {
        return Err("Session path must be absolute".into());
    }
    let root = crate::runtime::effective_home()?.join("state").join("sessions");
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = fs::canonicalize(&session_path).map_err(|error| error.to_string())?;
    if !path.starts_with(&root) || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err("Flow reports are only available for session files".into());
    }
    Ok(read_flow_reports(&path))
}

fn read_flow_reports(path: &Path) -> Vec<FlowReportRecord> {
    let Ok(file) = File::open(path) else { return Vec::new() };
    let reader = BufReader::new(file.take(32 * 1024 * 1024));
    let mut reports = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        if value.get("type").and_then(Value::as_str) != Some("custom_message") {
            continue;
        }
        if value.get("display").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let Some(custom_type) = value.get("customType").and_then(Value::as_str) else { continue };
        if !custom_type.starts_with("jouzu-flow") {
            continue;
        }
        let Some(content) = value.get("content") else { continue };
        let text = text_from_content(content);
        let Ok(parsed) = serde_json::from_str::<Value>(&text) else { continue };
        let Some(kind) = parsed.get("kind").and_then(Value::as_str) else { continue };
        reports.push(FlowReportRecord { kind: kind.to_string(), text });
    }
    if reports.len() > 30 {
        reports.drain(0..reports.len() - 30);
    }
    reports
}

fn normalize_workspace(value: &str) -> String {
    value
        .strip_prefix(r"\\?\")
        .unwrap_or(value)
        .trim_end_matches(['\\', '/'])
        .to_string()
}

fn text_from_content(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    block.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn title_from_content(content: &Value) -> String {
    let cleaned = text_from_content(content).split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title = cleaned.chars().take(MAX_TITLE_CHARS).collect::<String>();
    if cleaned.chars().count() > MAX_TITLE_CHARS {
        title.push('…');
    }
    title
}

fn session_header(path: &Path) -> (String, String) {
    let Ok(file) = File::open(path) else {
        return (String::new(), String::new());
    };
    let mut reader = BufReader::new(file.take(MAX_PREFIX_BYTES));
    let mut line = String::new();
    let mut workspace = String::new();
    let mut title = String::new();
    for _ in 0..MAX_LINES {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("session") => {
                if let Some(cwd) = value.get("cwd").and_then(Value::as_str) {
                    workspace = normalize_workspace(cwd);
                }
            }
            Some("message") => {
                let Some(message) = value.get("message") else {
                    continue;
                };
                if message.get("role").and_then(Value::as_str) != Some("user") {
                    continue;
                }
                let Some(content) = message.get("content") else {
                    continue;
                };
                let candidate = title_from_content(content);
                if !candidate.is_empty() {
                    title = candidate;
                    break;
                }
            }
            _ => {}
        }
    }
    (workspace, title)
}

fn list_sessions(directory: &Path) -> Vec<SessionSummary> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        let updated = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_secs());
        let (workspace, title) = session_header(&path);
        if title.is_empty() || workspace.is_empty() {
            continue;
        }
        sessions.push(SessionSummary {
            path: path.to_string_lossy().into_owned(),
            title,
            workspace,
            updated,
        });
    }
    sessions.sort_by(|left, right| right.updated.cmp(&left.updated));
    sessions.truncate(MAX_SESSIONS);
    sessions
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_session(path: &Path, cwd: &str, title: &str) {
        let mut file = File::create(path).unwrap();
        writeln!(
            file,
            "{}",
            serde_json::json!({"type":"session","version":3,"id":"s","cwd":cwd})
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            serde_json::json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":title}]}})
        )
        .unwrap();
    }

    #[test]
    fn lists_sessions_newest_first_with_titles_and_normalized_workspaces() {
        let directory = tempfile::tempdir().unwrap();
        let older = directory.path().join("older.jsonl");
        let newer = directory.path().join("newer.jsonl");
        write_session(&older, r"\\?\C:\Work\One", "  Fix   the parser  ");
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_session(&newer, r"C:\Work\Two", "Add a workspace rail");
        let sessions = list_sessions(directory.path());
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].path, newer.to_string_lossy());
        assert_eq!(sessions[0].workspace, r"C:\Work\Two");
        assert_eq!(sessions[0].title, "Add a workspace rail");
        assert_eq!(sessions[1].path, older.to_string_lossy());
        assert_eq!(sessions[1].workspace, r"C:\Work\One");
        assert_eq!(sessions[1].title, "Fix the parser");
    }

    #[test]
    fn reads_only_displayed_flow_reports() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("flow.jsonl");
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"custom_message","customType":"jouzu-flow","display":true,"content":[{"type":"text","text":"{\"kind\":\"work\",\"content\":\"Continue\"}"}]})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"custom_message","customType":"jouzu-flow","content":[{"type":"text","text":format!("{{\"kind\":\"work\",\"content\":\"{}\"}}", "long ".repeat(40))}]})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"custom_message","customType":"jouzu-flow","display":false,"content":[{"type":"text","text":"{\"kind\":\"alert\",\"content\":\"Hidden\"}"}]})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"custom_message","customType":"other","content":[{"type":"text","text":"{\"kind\":\"result\"}"}]})).unwrap();
        let reports = read_flow_reports(&path);
        assert_eq!(reports.len(), 2);
        assert_eq!(reports[0].kind, "work");
        assert!(reports[0].text.contains("Continue"));
        assert!(reports[1].text.contains("long long"));
    }

    #[test]
    fn ignores_invalid_and_empty_files() {        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("broken.jsonl"), "not json\n").unwrap();
        std::fs::write(directory.path().join("ignore.txt"), "{}").unwrap();
        std::fs::write(directory.path().join("empty.jsonl"), "{\"type\":\"session\",\"cwd\":\"C:\\\\Empty\"}\n").unwrap();
        assert!(list_sessions(directory.path()).is_empty());
    }
}
