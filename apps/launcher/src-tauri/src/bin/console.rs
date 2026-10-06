#[path = "../launcher_script.rs"]
mod launcher_script;
#[path = "../git_environment.rs"]
mod git_environment;
#[path = "../node_path.rs"]
mod node_path;
#[path = "../update_lock.rs"]
mod update_lock;
#[path = "../active_app.rs"]
mod active_app;
#[path = "../logs.rs"]
mod logs;
use std::{
    io,
    path::PathBuf,
    process::{Command, Stdio},
};
#[cfg(windows)]
fn bind_console() -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    unsafe extern "system" {
        fn SetStdHandle(which: u32, handle: *mut std::ffi::c_void) -> i32;
    }
    for (name, which, _read) in [
        ("CONIN$", -10i32, true),
        ("CONOUT$", -11, false),
        ("CONOUT$", -12, false),
    ] {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(name)?;
        if unsafe { SetStdHandle(which as u32, file.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        std::mem::forget(file);
    }
    Ok(())
}
fn main() {
    #[cfg(windows)]
    let _ = bind_console();
    // Both the launcher and a later detached entry start this program, so the managed root may arrive
    // as an argument or be the default location; the log line uses the same path the session does.
    let managed_hint = std::env::args_os().nth(2).map(PathBuf::from).or_else(|| {
        std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Shisa.ai/Jouzu"))
    });
    let result = (|| -> Result<i32, String> {
        let root = PathBuf::from(
            std::env::args_os()
                .nth(1)
                .ok_or("Missing application directory")?,
        );
        let managed = managed_hint.clone().ok_or("Missing managed directory")?;
        let _lease = update_lock::lock(&managed, false)?;
        let app = active_app::resolve_app(&root, &managed)?;
        let bash = git_environment::find(&root)?;
        logs::append(&managed, "session.log", &format!("start app={}", app.display()));
        let status = Command::new(root.join("runtime/node/node.exe"))
            .arg(node_path::node_path(&app.join("bootstrap.mjs")))
            .env("JOUZU_LAUNCHER_BASH", bash)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .map_err(|e| e.to_string())?;
        let code = status.code().unwrap_or(1);
        logs::append(&managed, "session.log", &format!("end exit={code}"));
        Ok(code)
    })();
    let code = match result {
        Ok(code) => code,
        Err(error) => {
            if let Some(managed) = &managed_hint {
                logs::append(managed, "session.log", &format!("end exit=1 error={error}"));
            }
            eprintln!("Jouzu: {error}");
            1
        }
    };
    if code != 0 {
        eprintln!("Jouzu exited with code {code}. Press Enter to close.");
        let _ = io::stdin().read_line(&mut String::new());
    }
    std::process::exit(code);
}
