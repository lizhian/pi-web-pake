// Loaded by the host application's test module to use its generated ACL manifest.
use crate::app::config::PakeConfig;
use std::collections::BTreeMap;
use tauri::ipc::RuntimeCapability;
use tauri::utils::acl::{
    capability::{Capability, CapabilityFile},
    manifest::Manifest,
    resolved::Resolved,
    ExecutionContext,
};
use tauri::Url;

fn config_for(url: &str) -> PakeConfig {
    let mut config: PakeConfig = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/pake.json"
    )))
    .unwrap();
    config.windows[0].url = url.into();
    config.windows[0].url_type = "web".into();
    config
}

fn resolve(config: &PakeConfig) -> Resolved {
    let manifest: BTreeMap<String, Manifest> = serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/acl-manifests.json"
    )))
    .unwrap();
    let local: Capability = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/capabilities/default.json"
    )))
    .unwrap();
    let mut capabilities = BTreeMap::from([(local.identifier.clone(), local)]);
    let CapabilityFile::List(enhanced) = pake_enhancements::runtime_capabilities(
        &config.enhancements,
        config.remote_capability().unwrap(),
    )
    .build() else {
        unreachable!()
    };
    for capability in enhanced {
        capabilities.insert(capability.identifier.clone(), capability);
    }
    Resolved::resolve(
        &manifest,
        capabilities,
        tauri::utils::platform::Target::current(),
    )
    .unwrap()
}

fn allows(acl: &Resolved, command: &str, label: &str, url: Option<&str>) -> bool {
    acl.allowed_commands.get(command).is_some_and(|grants| {
        grants.iter().any(|grant| {
            let context_matches = match (&grant.context, url) {
                (ExecutionContext::Local, None) => true,
                (ExecutionContext::Remote { url: pattern }, Some(url)) => {
                    pattern.test(&Url::parse(url).unwrap())
                }
                _ => false,
            };
            context_matches && grant.webviews.iter().any(|pattern| pattern.matches(label))
        })
    })
}

#[test]
fn open_path_defaults_off_and_only_adds_the_requested_operation() {
    let mut config = config_for("https://example.com");
    assert!(!config.enhancements.allow_open_path);
    let command = "plugin:opener|open_path";
    for enabled in [false, true] {
        config.enhancements.allow_open_path = enabled;
        let acl = resolve(&config);
        for label in ["pake", "pake-1"] {
            assert_eq!(allows(&acl, command, label, None), enabled);
            assert_eq!(
                allows(&acl, command, label, Some("https://example.com")),
                enabled
            );
            for denied in [
                "http://example.com",
                "https://example.com:8443",
                "https://sub.example.com",
                "https://evil.com",
            ] {
                assert!(!allows(&acl, command, label, Some(denied)));
            }
            for other in ["plugin:opener|open_url", "plugin:opener|reveal_item_in_dir"] {
                assert!(!allows(&acl, other, label, Some("https://example.com")));
            }
        }
        assert!(!allows(&acl, command, "unrelated", None));
        assert!(!allows(
            &acl,
            command,
            "unrelated",
            Some("https://example.com")
        ));
    }
}

#[test]
fn open_path_uses_configured_origins_and_also_supports_local_content() {
    for entry in [
        "http://127.0.0.1:8123",
        "http://[::1]:8123",
        "https://例子.测试",
    ] {
        let mut config = config_for(entry);
        config.enhancements.allow_open_path = true;
        let acl = resolve(&config);
        assert!(allows(&acl, "plugin:opener|open_path", "pake", Some(entry)));
        assert!(!allows(
            &acl,
            "plugin:opener|open_path",
            "pake",
            Some("http://127.0.0.1:8124")
        ));
    }
    let mut config = config_for("index.html");
    config.windows[0].url_type = "local".into();
    config.enhancements.allow_open_path = true;
    let acl = resolve(&config);
    assert!(allows(&acl, "plugin:opener|open_path", "pake", None));
    assert!(!allows(
        &acl,
        "plugin:opener|open_path",
        "pake",
        Some("https://example.com")
    ));
}
