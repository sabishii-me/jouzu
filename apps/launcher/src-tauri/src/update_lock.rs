use std::{fs::{File,OpenOptions},path::Path};
/// Windows sharing modes provide OS-released locks (including process crashes).
/// Readers are running app consumers; writer is the update/cleanup transaction.
pub fn lock(managed:&Path, exclusive:bool)->Result<File,String>{
 let root=managed.join("updates");std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
 let path=root.join("sessions.lock");
 if !path.exists(){
  match OpenOptions::new().write(true).create_new(true).open(&path){
   Ok(file)=>drop(file),Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err("Cannot initialize update session lock".into())
  }
 }
 let mut options=OpenOptions::new();options.read(true).write(exclusive);
 #[cfg(windows)]{use std::os::windows::fs::OpenOptionsExt;options.share_mode(if exclusive {0}else{1});}
 #[cfg(not(windows))] {return Err("Update session locking is not available on this platform".into());}
 options.open(path).map_err(|_|"Close running Jouzu sessions and wait for other operations before updating".into())
}
#[cfg(all(test,windows))]
mod tests {use super::*;#[test]fn reader_writer_exclusion(){let dir=tempfile::tempdir().unwrap();let a=lock(dir.path(),false).unwrap();let b=lock(dir.path(),false).unwrap();assert!(lock(dir.path(),true).is_err());drop(a);drop(b);let w=lock(dir.path(),true).unwrap();assert!(lock(dir.path(),false).is_err());drop(w);assert!(lock(dir.path(),true).is_ok());}}
