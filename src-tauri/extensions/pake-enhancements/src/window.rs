use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewWindowBuilder, Wry};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct WindowConfig {
    #[serde(default)]
    pub traffic_light_x: Option<f64>,
    #[serde(default)]
    pub traffic_light_y: Option<f64>,
    #[serde(default)]
    pub drag_region_height: Option<f64>,
}

pub fn configure_window<'a, M: Manager<Wry>>(
    mut builder: WebviewWindowBuilder<'a, Wry, M>,
    config: &WindowConfig,
    hide_title_bar: bool,
) -> WebviewWindowBuilder<'a, Wry, M> {
    if config.drag_region_height.is_some() {
        builder = builder.initialization_script(include_str!("window.js"));
    }
    #[cfg(target_os = "macos")]
    if let (Some(x), Some(y)) = (config.traffic_light_x, config.traffic_light_y) {
        if hide_title_bar {
            builder = builder.traffic_light_position(tauri::LogicalPosition::new(x, y));
        }
    }
    let _ = hide_title_bar;
    builder
}
