use std::{
    fs::{create_dir_all, metadata, rename, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// A log file rotates once it reaches this size, so diagnostics cannot grow without bound.
const MAX_BYTES: u64 = 1024 * 1024;

/// Logs live beside the managed state: one root holds everything an installation writes, and the
/// uninstaller removes it with the rest.
pub fn directory(managed: &Path) -> PathBuf {
    managed.join("logs")
}

/// Append one timestamped line. Diagnostics never fail the operation they describe, so every error
/// here is dropped rather than returned.
pub fn append(managed: &Path, file: &str, message: &str) {
    let directory = directory(managed);
    if create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join(file);
    if metadata(&path).map(|size| size.len() >= MAX_BYTES).unwrap_or(false) {
        let _ = rename(&path, directory.join(format!("{file}.1")));
    }
    if let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(handle, "{} {message}", timestamp());
    }
}

/// ISO 8601 in UTC, so a line can be read without a tool that knows an epoch, and without a time
/// library the release does not otherwise need.
fn timestamp() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => iso8601(elapsed.as_secs() as i64),
        Err(_) => "1970-01-01T00:00:00Z".to_string(),
    }
}

fn iso8601(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// The inverse of days-from-civil, so a date comes out of a count of days.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_part + 2) / 5 + 1) as u32;
    let month = if month_part < 10 { month_part + 3 } else { month_part - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_without_a_time_library() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601(1_767_000_000), "2025-12-29T09:20:00Z");
        assert_eq!(iso8601(1_757_971_300), "2025-09-15T21:21:40Z");
        assert_eq!(iso8601(1_759_713_000), "2025-10-06T01:10:00Z");
    }

    #[test]
    fn appends_a_line_per_call_and_rotates_at_the_cap() {
        let temp = tempfile::tempdir().unwrap();
        let managed = temp.path();
        append(managed, "launcher.log", "first");
        append(managed, "launcher.log", "second");
        let text = std::fs::read_to_string(directory(managed).join("launcher.log")).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.lines().last().unwrap().ends_with(" second"));

        std::fs::write(
            directory(managed).join("launcher.log"),
            "x".repeat(MAX_BYTES as usize),
        )
        .unwrap();
        append(managed, "launcher.log", "after rotation");
        assert_eq!(
            std::fs::metadata(directory(managed).join("launcher.log.1"))
                .unwrap()
                .len(),
            MAX_BYTES
        );
        let current = std::fs::read_to_string(directory(managed).join("launcher.log")).unwrap();
        assert!(current.ends_with(" after rotation\n"));
        assert!(current.len() < 64);
    }
}
