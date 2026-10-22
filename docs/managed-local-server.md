# Managed Local Server Extension

This fork can package a loopback web service as a desktop client. The extension is disabled for ordinary Pake builds and is compiled only when `--server-port` and `--server-command` are supplied.

## Options

| Option                          | Description                                               |
| ------------------------------- | --------------------------------------------------------- |
| `--server-port <number>`        | Loopback port to probe and manage, from 1 to 65535.       |
| `--server-command <string>`     | Foreground shell command that starts the local service.   |
| `--server-timeout <seconds>`    | Startup timeout from 1 to 3600 seconds; default `30`.     |
| `--traffic-light-x <number>`    | macOS traffic-light horizontal position.                  |
| `--traffic-light-y <number>`    | macOS traffic-light vertical position.                    |
| `--drag-region-height <number>` | Top drag-strip height; default `20`, and `0` disables it. |

`--server-port` and `--server-command` must be provided together. The target must be an HTTP or HTTPS URL using `localhost`, `127.0.0.1`, or `::1`, and its effective port must equal `--server-port`. Managed servers cannot be combined with `--multi-instance`.

At startup, the app reuses an existing listener without taking ownership. Otherwise it runs the command through the user's login shell on macOS/Linux or `cmd.exe` on Windows, then waits for the port. Hiding the window leaves an owned service running. Quitting stops only the process tree started by the app.

The command is embedded in the application. Never put passwords, tokens, or other secrets directly in `--server-command`. The command must remain in the foreground; commands that daemonize and exit cannot be managed reliably.

Traffic-light coordinates require `--hide-title-bar` and apply only to macOS. For a frameless Windows/Linux client, use `--hide-window-decorations --drag-region-height 10`.

## Pi Web

See the [Pi Web build guide](../build/pi-web/README.md) for the complete command, resources and dedicated tests.

## Fork Maintenance Boundary

The CLI enhancement facade in `bin/extensions/enhancements.ts` delegates managed-service behavior to `bin/extensions/managed-local-app/` and handles the independent `--allow-open-path` opt-in. The config loader dispatches extension fields once; upstream numeric validation and origin capability generation remain authoritative for upstream behavior.

The native implementation lives in the `src-tauri/extensions/pake-enhancements` workspace crate. The application retains a runtime adapter after single-instance registration, a capability adapter reusing the upstream configured origins, and a window-builder adapter shared by every window. Flattened configuration preserves the existing JSON fields. Window settings and path-opening authorization work independently of the optional `managed-server` feature; its dialog and process-management dependencies are enabled only for managed builds.

`.github/managed-local-apps.json` lists recipe paths and generic runner targets. The Pi Web recipe lives in `build/pi-web/recipe.json`. The release workflow derives its matrix and expected artifact filenames from this data. Add another application through a recipe rather than editing the builder. Existing identifiers and release names stay stable.

All upstream tests are retained. Enhancement tests cover CLI/config mapping, native authorization and process lifecycles. `tests/integration/managed-local-app.mjs` uses one generic native fixture for ordinary builds, concurrent managed startup, CSP popups, minimized-window service survival and cleanup on exit. On macOS, `tests/integration/enhancement-open-path.mjs` uses one fixture to verify real WebView permissions and system opening with the opt-in disabled and enabled. The upstream IPC acceptance remains unchanged and runs separately once. Pi Web injection tests are maintained separately.

After syncing upstream, run:

```shell
pnpm run cli:build
pnpm exec vitest run
cd src-tauri
cargo test --locked --workspace --lib
cargo test --locked --workspace --lib --features managed-server
cargo test --locked --workspace --lib --features runtime-template
cargo test --locked --workspace --lib --features managed-server,runtime-template
cargo clippy --locked --workspace --all-targets --features managed-server,runtime-template -- -D warnings
cd ..
node tests/integration/managed-local-app.mjs
# macOS only
node tests/integration/ipc-security.mjs
node tests/integration/enhancement-open-path.mjs
```

The Enhancement Compatibility workflow runs the four feature configurations and Clippy on macOS, Linux, Windows x64 and Windows ARM64, then runs the native fixture. The ARM64 job also verifies a real MSI's platform metadata. Linux native acceptance uses Xvfb and a D-Bus session.
