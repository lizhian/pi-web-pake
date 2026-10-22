use crate::AppConfig;
use tauri::ipc::{CapabilityBuilder, RuntimeCapability};
use tauri::utils::acl::capability::{Capability, CapabilityFile, CapabilityRemote};

pub(crate) fn configure(
    config: &AppConfig,
    tauri_config: &mut tauri::Config,
) -> Result<(), Box<dyn std::error::Error>> {
    if config.allow_open_path {
        let opener = tauri_config
            .plugins
            .0
            .entry("opener".into())
            .or_insert_with(|| serde_json::json!({}));
        let opener = opener
            .as_object_mut()
            .ok_or("The opener plugin configuration must be an object")?;
        opener.insert("requireLiteralLeadingDot".into(), false.into());
    }
    Ok(())
}

struct Capabilities(Vec<Capability>);

impl RuntimeCapability for Capabilities {
    fn build(self) -> CapabilityFile {
        CapabilityFile::List(self.0)
    }
}

/// Keep the upstream grants intact and inherit their immutable origin patterns.
pub fn runtime_capabilities(
    config: &AppConfig,
    remote: Option<impl RuntimeCapability>,
) -> impl RuntimeCapability {
    let mut capabilities = match remote.map(RuntimeCapability::build) {
        Some(CapabilityFile::Capability(capability)) => vec![capability],
        Some(CapabilityFile::List(list) | CapabilityFile::NamedList { capabilities: list }) => list,
        None => Vec::new(),
    };
    if config.allow_open_path {
        let CapabilityFile::Capability(mut opener) = CapabilityBuilder::new("pake-open-path")
            .webviews(["pake", "pake-*"])
            .permission_scoped(
                "opener:allow-open-path",
                vec![serde_json::json!({ "path": "**" })],
                Vec::new(),
            )
            .build()
        else {
            unreachable!("CapabilityBuilder produces one capability");
        };
        let mut origins = Vec::new();
        for capability in &capabilities {
            if let Some(remote) = &capability.remote {
                origins.extend(remote.urls.iter().cloned());
                opener.webviews.clone_from(&capability.webviews);
                opener.windows.clone_from(&capability.windows);
            }
        }
        if !origins.is_empty() {
            opener.remote = Some(CapabilityRemote { urls: origins });
        }
        capabilities.push(opener);
    }
    Capabilities(capabilities)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_off_and_preserves_unrelated_plugin_settings() {
        let mut config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!config.allow_open_path);
        let mut tauri_config: tauri::Config = serde_json::from_value(serde_json::json!({
            "identifier": "com.pake.any-app",
            "plugins": { "opener": { "requireLiteralLeadingDot": true, "other": 1 } }
        }))
        .unwrap();
        let baseline = tauri_config.plugins.0.clone();
        configure(&config, &mut tauri_config).unwrap();
        assert_eq!(tauri_config.plugins.0, baseline);
        config.allow_open_path = true;
        configure(&config, &mut tauri_config).unwrap();
        assert_eq!(
            tauri_config.plugins.0["opener"]["requireLiteralLeadingDot"],
            false
        );
        assert_eq!(tauri_config.plugins.0["opener"]["other"], 1);
    }

    #[test]
    fn grant_keeps_the_upstream_capability_and_only_scopes_paths_to_the_default_app() {
        let upstream = CapabilityBuilder::new("upstream")
            .remote("https://example.com/*".into())
            .webviews(["pake", "pake-*"])
            .permission("core:window:allow-close");
        let config: AppConfig =
            serde_json::from_value(serde_json::json!({ "allow_open_path": true })).unwrap();
        let CapabilityFile::List(capabilities) =
            runtime_capabilities(&config, Some(upstream)).build()
        else {
            unreachable!()
        };
        assert_eq!(capabilities.len(), 2);
        assert_eq!(capabilities[0].identifier, "upstream");
        let opener = &capabilities[1];
        assert!(opener.local);
        assert_eq!(
            opener.remote.as_ref().unwrap().urls,
            capabilities[0].remote.as_ref().unwrap().urls
        );
        assert_eq!(opener.webviews, capabilities[0].webviews);
        assert_eq!(
            serde_json::to_value(&opener.permissions).unwrap(),
            serde_json::json!([{
                "identifier": "opener:allow-open-path", "allow": [{ "path": "**" }], "deny": []
            }])
        );
    }
}
