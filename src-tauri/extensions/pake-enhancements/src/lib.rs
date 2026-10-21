#[cfg(feature = "managed-server")]
mod process;
#[cfg(feature = "managed-server")]
mod server;
mod window;

use serde::{Deserialize, Serialize};
pub use window::{configure_window, WindowConfig};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AppConfig {
    #[cfg(feature = "managed-server")]
    #[serde(default)]
    pub server: Option<server::ServerConfig>,
}

pub fn configure_runtime(
    builder: tauri::Builder<tauri::Wry>,
    config: &AppConfig,
    multi_instance: bool,
) -> tauri::Builder<tauri::Wry> {
    #[cfg(feature = "managed-server")]
    if config.server.is_some() {
        return builder
            .plugin(tauri_plugin_dialog::init())
            .plugin(server::plugin(config.server.clone(), multi_instance));
    }
    let _ = (config, multi_instance);
    builder
}
