use super::*;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
struct Fixture {
    directory: PathBuf,
    executable: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "pake-server-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let executable = directory.join(format!("server{}", std::env::consts::EXE_SUFFIX));
        let compiler = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
        let output = Command::new(compiler)
            .arg("--edition=2021")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/server.rs"
            ))
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Self {
            directory,
            executable,
        }
    }
    fn command(&self, mode: &str, port: u16) -> String {
        #[cfg(unix)]
        let executable = format!(
            "'{}'",
            self.executable.to_string_lossy().replace('\'', "'\\''")
        );
        #[cfg(windows)]
        let executable = format!("\"{}\"", self.executable.display());
        format!("{executable} {mode} {port}")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.directory).unwrap();
    }
}
fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
fn config(port: u16, command: String, timeout: u64) -> ServerConfig {
    ServerConfig {
        host: "127.0.0.1".into(),
        port,
        command,
        timeout,
    }
}
fn assert_closed(port: u16) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while port_is_listening(&config(port, String::new(), 1)).unwrap() {
        assert!(
            Instant::now() < deadline,
            "owned descendant remained on port {port}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
#[test]
fn reuses_an_existing_listener_without_ownership() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(start_or_reuse(Some(&config(port, "unused".into(), 1)))
        .unwrap()
        .is_none());
    assert!(port_is_listening(&config(port, String::new(), 1)).unwrap());
}
#[test]
fn starts_and_terminates_an_owned_process_tree() {
    let fixture = Fixture::new();
    let port = free_port();
    let server = start_or_reuse(Some(&config(port, fixture.command("parent", port), 5)))
        .unwrap()
        .unwrap();
    assert!(port_is_listening(&config(port, String::new(), 1)).unwrap());
    let owned = Arc::new(Mutex::new(Some(server)));
    terminate_owned(&owned);
    assert_closed(port);
}
#[test]
fn reports_early_exit_and_cleans_surviving_descendants() {
    let fixture = Fixture::new();
    let child_port = free_port();
    let port = free_port();
    let error = start_or_reuse(Some(&config(
        port,
        fixture.command("orphan", child_port),
        5,
    )))
    .unwrap_err();
    assert!(error.contains("exited before port"), "{error}");
    assert_eq!(
        std::fs::read_to_string(fixture.directory.join("ready")).unwrap(),
        child_port.to_string()
    );
    assert_closed(child_port);
}
#[test]
fn reports_timeout_and_cleans_the_process_tree() {
    let fixture = Fixture::new();
    let child_port = free_port();
    let port = free_port();
    let error = start_or_reuse(Some(&config(
        port,
        fixture.command("parent", child_port),
        1,
    )))
    .unwrap_err();
    assert!(error.contains("within 1 seconds"), "{error}");
    assert_eq!(
        std::fs::read_to_string(fixture.directory.join("ready")).unwrap(),
        child_port.to_string()
    );
    assert_closed(child_port);
}
