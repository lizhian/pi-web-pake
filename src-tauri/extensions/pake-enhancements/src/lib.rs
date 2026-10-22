mod open_path;
#[cfg(feature = "managed-server")]
mod process;
#[cfg(feature = "managed-server")]
mod server;
mod window;

pub use open_path::runtime_capabilities;
use serde::{Deserialize, Serialize};
pub use window::{configure_window, WindowConfig};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AppConfig {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub allow_open_path: bool,
    #[cfg(feature = "managed-server")]
    #[serde(default)]
    pub server: Option<server::ServerConfig>,
}

pub fn configure_runtime(
    builder: tauri::Builder<tauri::Wry>,
    config: &AppConfig,
    multi_instance: bool,
    tauri_config: &mut tauri::Config,
) -> Result<tauri::Builder<tauri::Wry>, Box<dyn std::error::Error>> {
    open_path::configure(config, tauri_config)?;
    #[cfg(feature = "managed-server")]
    if config.server.is_some() {
        return Ok(builder
            .plugin(tauri_plugin_dialog::init())
            .plugin(server::plugin(config.server.clone(), multi_instance)));
    }
    let _ = (config, multi_instance);
    Ok(builder)
}
