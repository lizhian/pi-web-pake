use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = args[2].parse().unwrap();
    if args[1] == "listener" {
        let _listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
        loop {
            std::thread::sleep(Duration::from_secs(60));
        }
    }
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["listener", &port.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(Instant::now() < deadline, "fixture child did not listen");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::fs::write(
        std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .join("ready"),
        port.to_string(),
    )
    .unwrap();
    if args[1] == "orphan" {
        std::process::exit(7);
    }
    child.wait().unwrap();
}
