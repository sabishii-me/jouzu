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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTiming {
    pub model_ms: u64,
    pub tool_ms: u64,
    pub turns: u32,
    pub steps: u32,
    pub output_tokens: u64,
}

#[tauri::command]
pub fn chat_session_timing(session_path: String) -> Result<SessionTiming, String> {
    let path = validated_session_path(&session_path)?;
    Ok(read_session_timing(&path))
}

fn validated_session_path(session_path: &str) -> Result<std::path::PathBuf, String> {
    if session_path.contains('\0') || !Path::new(session_path).is_absolute() {
        return Err("Session path must be absolute".into());
    }
    let root = crate::runtime::effective_home()?.join("state").join("sessions");
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = fs::canonicalize(session_path).map_err(|error| error.to_string())?;
    if !path.starts_with(&root) || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err("Only session files are accepted".into());
    }
    Ok(path)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
fn iso_to_millis(value: &str) -> Option<i64> {
    let value = value.strip_suffix('Z')?;
    let (date, time) = value.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i64>().ok()?;
    let month = date_parts.next()?.parse::<i64>().ok()?;
    let day = date_parts.next()?.parse::<i64>().ok()?;
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<i64>().ok()?;
    let minute = time_parts.next()?.parse::<i64>().ok()?;
    let seconds = time_parts.next()?;
    let (second, millis) = seconds.split_once('.').map_or((seconds, "0"), |(second, fraction)| (second, fraction));
    let second = second.parse::<i64>().ok()?;
    let millis = format!("{millis:0<3}").chars().take(3).collect::<String>().parse::<i64>().ok()?;
    let days = days_from_civil(year, month, day);
    Some(((days * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000) + millis)
}

fn read_session_timing(path: &Path) -> SessionTiming {
    let Ok(file) = File::open(path) else { return SessionTiming { model_ms: 0, tool_ms: 0, turns: 0, steps: 0, output_tokens: 0 } };
    let reader = BufReader::new(file.take(32 * 1024 * 1024));
    let mut result = SessionTiming { model_ms: 0, tool_ms: 0, turns: 0, steps: 0, output_tokens: 0 };
    let mut previous_entry_ts: Option<i64> = None;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        let entry_ts = value.get("timestamp").and_then(Value::as_str).and_then(iso_to_millis);
        if value.get("type").and_then(Value::as_str) != Some("message") {
            if entry_ts.is_some() { previous_entry_ts = entry_ts; }
            continue;
        }
        let Some(message) = value.get("message") else { continue };
        let role = message.get("role").and_then(Value::as_str).unwrap_or_default();
        if role == "toolResult" {
            if let (Some(started), Some(ended)) = (previous_entry_ts, entry_ts) {
                result.tool_ms += ended.saturating_sub(started).max(0) as u64;
            }
        } else if role == "user" {
            result.turns += 1;
        } else if role == "assistant" {
            result.steps += 1;
            result.output_tokens += message.get("usage").and_then(|usage| usage.get("output")).and_then(Value::as_u64).unwrap_or(0);
            if let (Some(started), Some(ended)) = (message.get("timestamp").and_then(Value::as_i64), entry_ts) {
                result.model_ms += ended.saturating_sub(started).max(0) as u64;
            }
        }
        if entry_ts.is_some() { previous_entry_ts = entry_ts; }
    }
    result
}

#[tauri::command]
pub fn chat_session_messages(session_path: String) -> Result<Vec<Value>, String> {
    let path = validated_session_path(&session_path)?;
    Ok(read_session_messages(&path))
}

fn read_session_messages(path: &Path) -> Vec<Value> {
    let Ok(file) = File::open(path) else { return Vec::new() };
    let reader = BufReader::new(file.take(32 * 1024 * 1024));
    let mut messages = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        if value.get("type").and_then(Value::as_str) == Some("message") {
            if let Some(message) = value.get("message") {
                messages.push(message.clone());
            }
        }
    }
    messages
}

#[tauri::command]
pub fn chat_flow_reports(session_path: String) -> Result<Vec<FlowReportRecord>, String> {
    let path = validated_session_path(&session_path)?;
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
    fn derives_model_and_tool_time_from_session_entries() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("timing.jsonl");
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"message","timestamp":"2026-10-19T15:08:07.000Z","message":{"role":"user","content":[]}})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"message","timestamp":"2026-10-19T15:08:08.797Z","message":{"role":"assistant","timestamp":1792422487810_i64,"usage":{"output":96},"content":[{"type":"toolCall","id":"call"}]}})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"message","timestamp":"2026-10-19T15:08:08.824Z","message":{"role":"toolResult","content":[]}})).unwrap();
        let timing = read_session_timing(&path);
        assert_eq!(timing.turns, 1);
        assert_eq!(timing.steps, 1);
        assert_eq!(timing.output_tokens, 96);
        assert_eq!(timing.model_ms, 987);
        assert_eq!(timing.tool_ms, 27);
    }

    #[test]
    fn reads_session_messages_for_an_instant_preview() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("messages.jsonl");
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":"hello"}]}})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"custom_message","customType":"other","content":[]})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}})).unwrap();
        let messages = read_session_messages(&path);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
    }

    #[test]
    fn ignores_invalid_and_empty_files() {        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("broken.jsonl"), "not json\n").unwrap();
        std::fs::write(directory.path().join("ignore.txt"), "{}").unwrap();
        std::fs::write(directory.path().join("empty.jsonl"), "{\"type\":\"session\",\"cwd\":\"C:\\\\Empty\"}\n").unwrap();
        assert!(list_sessions(directory.path()).is_empty());
    }
}
