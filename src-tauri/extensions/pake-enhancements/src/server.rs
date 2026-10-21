use crate::process::ManagedProcess;
use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, RunEvent, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const PROBE_INTERVAL: Duration = Duration::from_millis(150);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub command: String,
    #[serde(default = "default_server_timeout")]
    pub timeout: u64,
}

fn default_server_timeout() -> u64 {
    30
}

type ManagedServer = crate::process::ManagedProcess;
type OwnedServer = Arc<Mutex<Option<ManagedServer>>>;

fn socket_addresses(config: &ServerConfig) -> Result<Vec<std::net::SocketAddr>, String> {
    (config.host.as_str(), config.port)
        .to_socket_addrs()
        .map(|addresses| addresses.collect())
        .map_err(|error| {
            format!(
                "Could not resolve local server address {}:{}: {error}",
                config.host, config.port
            )
        })
}

fn port_is_listening(config: &ServerConfig) -> Result<bool, String> {
    let addresses = socket_addresses(config)?;
    Ok(addresses
        .iter()
        .any(|address| TcpStream::connect_timeout(address, CONNECT_TIMEOUT).is_ok()))
}

fn start_or_reuse(config: Option<&ServerConfig>) -> Result<Option<ManagedServer>, String> {
    let Some(config) = config else {
        return Ok(None);
    };
    if !["localhost", "127.0.0.1", "::1"].contains(&config.host.as_str())
        || config.port == 0
        || !(1..=3600).contains(&config.timeout)
        || config.command.trim().is_empty()
    {
        return Err("Invalid managed local server configuration.".to_string());
    }
    if port_is_listening(config)? {
        return Ok(None);
    }

    let mut server = ManagedProcess::spawn(&config.command)?;
    let deadline = Instant::now() + Duration::from_secs(config.timeout);
    while Instant::now() < deadline {
        match server.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "The local server command exited before port {} was ready ({status}). Run the command in a terminal to inspect the error.",
                    config.port
                ));
            }
            Ok(None) => {}
            Err(error) => {
                return Err(format!(
                    "Could not inspect the local server process: {error}"
                ));
            }
        }

        if port_is_listening(config)? {
            return Ok(Some(server));
        }
        std::thread::sleep(PROBE_INTERVAL);
    }

    Err(format!(
        "The local server did not listen on {}:{} within {} seconds.",
        config.host, config.port, config.timeout
    ))
}

fn terminate_owned(server: &OwnedServer) {
    let mut server = server
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    server.take();
}

pub(crate) fn plugin(config: Option<ServerConfig>, multi_instance: bool) -> TauriPlugin<Wry> {
    let owned_server: OwnedServer = Arc::new(Mutex::new(None));
    let setup_server = owned_server.clone();

    PluginBuilder::new("managed-local-server")
        .setup(move |app, _api| {
            let started = if multi_instance {
                Err("Managed local servers require single-instance mode.".to_string())
            } else {
                start_or_reuse(config.as_ref())
            };
            match started {
                Ok(server) => {
                    *setup_server
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner) = server;
                    Ok(())
                }
                Err(error) => {
                    show_startup_error(app, &error);
                    Err(std::io::Error::other(error).into())
                }
            }
        })
        .on_event(move |_app, event| {
            if matches!(event, RunEvent::Exit) {
                terminate_owned(&owned_server);
            }
        })
        .build()
}

fn show_startup_error(app: &AppHandle, message: &str) {
    eprintln!("[Pake] Local server startup failed: {message}");
    app.dialog()
        .message(message)
        .title("Pake could not start the local server")
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
