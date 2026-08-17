use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const PI_WEB_ADDRESS: &str = "127.0.0.1:30141";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_INTERVAL: Duration = Duration::from_millis(150);

pub type OwnedPiWeb = Arc<Mutex<Option<Child>>>;

#[derive(Debug, Eq, PartialEq)]
enum ProbeResult {
    Ready,
    Unreachable,
    OtherService,
}

fn response_is_pi_web(response: &[u8]) -> bool {
    let response = String::from_utf8_lossy(response);
    response.contains("<title>Pi Web</title>")
        || response.contains("content=\"Pi Web interface for the pi coding agent\"")
        || response.contains("WWW-Authenticate: Basic realm=\"Pi Web\"")
}

fn probe_pi_web() -> ProbeResult {
    let address: SocketAddr = PI_WEB_ADDRESS.parse().expect("valid Pi Web address");
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return ProbeResult::Unreachable;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1:30141\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return ProbeResult::OtherService;
    }

    let mut response = Vec::with_capacity(16 * 1024);
    let _ = stream.take(256 * 1024).read_to_end(&mut response);
    if response_is_pi_web(&response) {
        ProbeResult::Ready
    } else {
        ProbeResult::OtherService
    }
}

fn spawn_pi_web() -> Result<Child, String> {
    // Finder-launched apps do not inherit the user's terminal PATH. A login,
    // interactive zsh loads Homebrew and common Node version-manager setup.
    let command = r#"
pi_web_bin="$(command -v pi-web)" || exit 127
case "$pi_web_bin" in
  /*) ;;
  *) exit 126 ;;
esac
exec "$pi_web_bin" --hostname 127.0.0.1 --port 30141 --no-open
"#;

    let mut process = Command::new("/bin/zsh");
    process
        .args(["-lic", command])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    process.process_group(0);

    process
        .spawn()
        .map_err(|error| format!("Could not launch the login shell: {error}"))
}

pub fn start_or_reuse() -> Result<Option<Child>, String> {
    match probe_pi_web() {
        ProbeResult::Ready => return Ok(None),
        ProbeResult::OtherService => {
            return Err(
                "Port 30141 is already in use by another service. Stop that service and open Pi Web Desktop again."
                    .to_string(),
            );
        }
        ProbeResult::Unreachable => {}
    }

    let mut child = spawn_pi_web()?;
    let deadline = Instant::now() + STARTUP_TIMEOUT;

    while Instant::now() < deadline {
        match probe_pi_web() {
            ProbeResult::Ready => return Ok(Some(child)),
            ProbeResult::OtherService => {
                terminate_child(&mut child);
                return Err(
                    "Port 30141 was claimed by another service while Pi Web was starting."
                        .to_string(),
                );
            }
            ProbeResult::Unreachable => {}
        }

        match child.try_wait() {
            Ok(Some(status)) if status.code() == Some(127) => {
                return Err(
                    "The pi-web command was not found in your login shell. Install it with: npm install -g @agegr/pi-web@latest"
                        .to_string(),
                );
            }
            Ok(Some(status)) => {
                return Err(format!(
                    "The pi-web command exited before the server was ready ({status}). Run pi-web in Terminal to inspect the error."
                ));
            }
            Ok(None) => {}
            Err(error) => {
                terminate_child(&mut child);
                return Err(format!("Could not inspect the pi-web process: {error}"));
            }
        }

        std::thread::sleep(PROBE_INTERVAL);
    }

    terminate_child(&mut child);
    Err("Pi Web did not become ready within 30 seconds.".to_string())
}

fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        // The child starts in its own process group. Stop both the pi-web CLI
        // and the Next.js server it owns, without touching a reused service.
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }

    #[cfg(not(unix))]
    let _ = child.kill();
}

pub fn terminate_owned(process: &OwnedPiWeb) {
    let Ok(mut process) = process.lock() else {
        return;
    };
    if let Some(child) = process.as_mut() {
        terminate_child(child);
    }
    process.take();
}

pub fn show_startup_error(message: &str) {
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display alert \"Pi Web Desktop could not start\" message \"{escaped}\" as critical buttons {{\"Quit\"}} default button \"Quit\""
    );
    let _ = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_pi_web_title() {
        let response = b"HTTP/1.0 200 OK\r\n\r\n<html><head><title>Pi Web</title></head></html>";
        assert!(response_is_pi_web(response));
    }

    #[test]
    fn recognizes_pi_web_description() {
        let response =
            b"<meta name=\"description\" content=\"Pi Web interface for the pi coding agent\"/>";
        assert!(response_is_pi_web(response));
    }

    #[test]
    fn recognizes_password_protected_pi_web() {
        let response =
            b"HTTP/1.0 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"Pi Web\", charset=\"UTF-8\"\r\n\r\n";
        assert!(response_is_pi_web(response));
    }

    #[test]
    fn rejects_an_unrelated_http_service() {
        let response = b"HTTP/1.0 200 OK\r\n\r\n<title>Another app</title>";
        assert!(!response_is_pi_web(response));
    }
}
