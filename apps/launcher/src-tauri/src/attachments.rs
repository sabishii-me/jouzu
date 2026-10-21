use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;

const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

/// Read an image path supplied by the native drag/drop event. The frontend still
/// validates the signature before attaching it to a message.
#[tauri::command]
pub fn read_dropped_image(path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&path);
    let metadata = std::fs::metadata(path).map_err(|_| "Dropped image is unavailable.")?;
    if !metadata.is_file() {
        return Err("Dropped item is not a file.".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err("Dropped image must be between 1 byte and 10 MB.".into());
    }
    let mime = match path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return Err("Dropped file is not a supported image.".into()),
    };
    let bytes = std::fs::read(path).map_err(|_| "Dropped image could not be read.")?;
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("dropped-image").to_string();
    Ok(serde_json::json!({ "name": name, "mimeType": mime, "data": STANDARD.encode(bytes) }))
}
