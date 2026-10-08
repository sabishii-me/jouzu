fn main() {
    println!("cargo:rerun-if-changed=../../../packaging/launcher/control.mjs");
    tauri_build::build()
}
