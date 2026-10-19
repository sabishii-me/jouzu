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

#[tauri::command]
pub fn chat_sessions() -> Result<Vec<SessionSummary>, String> {
    let home = crate::runtime::effective_home()?;
    Ok(list_sessions(&home.join("state/sessions")))
}

fn normalize_workspace(value: &str) -> String {
    value
        .strip_prefix(r"\\?\")
        .unwrap_or(value)
        .trim_end_matches(['\\', '/'])
        .to_string()
}

fn title_from_content(content: &Value) -> String {
    let text = match content {
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
            .join(" "),
        _ => String::new(),
    };
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
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
    fn ignores_invalid_and_empty_files() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("broken.jsonl"), "not json\n").unwrap();
        std::fs::write(directory.path().join("ignore.txt"), "{}").unwrap();
        std::fs::write(directory.path().join("empty.jsonl"), "{\"type\":\"session\",\"cwd\":\"C:\\\\Empty\"}\n").unwrap();
        assert!(list_sessions(directory.path()).is_empty());
    }
}
