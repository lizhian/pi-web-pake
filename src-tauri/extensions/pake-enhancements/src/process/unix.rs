use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub(crate) struct ManagedProcess {
    child: Child,
}
impl ManagedProcess {
    pub(crate) fn spawn(command: &str) -> Result<Self, String> {
        let fallback = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/sh"
        };
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|path| path.starts_with('/') && std::path::Path::new(path).is_file())
            .unwrap_or_else(|| fallback.to_string());
        let child = Command::new(shell)
            .args(["-lic", command])
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not start the local server command: {error}"))?;
        Ok(Self { child })
    }
    pub(crate) fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }
    fn signal(&self, signal: i32) {
        if unsafe { libc::kill(-(self.child.id() as i32), signal) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                eprintln!("[Pake] Could not signal the local server process group: {error}");
            }
        }
    }
    fn group_exists(&self) -> bool {
        unsafe { libc::kill(-(self.child.id() as i32), 0) == 0 }
    }
}
impl Drop for ManagedProcess {
    fn drop(&mut self) {
        // A shell can exit before its descendants. Always clean its owned group.
        self.signal(libc::SIGTERM);
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) if !self.group_exists() => return,
                Err(error) => {
                    eprintln!("[Pake] Could not inspect the local server during shutdown: {error}");
                    break;
                }
                _ => {}
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        self.signal(libc::SIGKILL);
        if let Err(error) = self.child.wait() {
            eprintln!("[Pake] Could not reap the local server: {error}");
        }
    }
}
