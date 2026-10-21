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

## DeepSeek Harness

DeepSeek Harness normally requires `dsh web` to remain open in a terminal. A managed build turns it into a desktop-client workflow:

```shell
node dist/cli.js http://127.0.0.1:3080 \
  --name "DeepSeek Harness" \
  --identifier "com.example.dshweb" \
  --server-port 3080 \
  --server-command "dsh --profile web --no-open --host 127.0.0.1 --port 3080" \
  --server-timeout 60 \
  --hide-title-bar \
  --traffic-light-x 2 \
  --traffic-light-y 6 \
  --drag-region-height 10 \
  --targets dmg
```

Use a fixed port rather than `dsh web --port 0`, because the desktop client needs a stable URL. `--no-open` prevents DeepSeek Harness from also opening the system browser. The `dsh` executable must be available through the shell `PATH` used by the packaged application.

Traffic-light coordinates require `--hide-title-bar` and apply only to macOS. For a frameless Windows/Linux client, use `--hide-window-decorations --drag-region-height 10`; traffic-light coordinates are ignored.

## Pi Web

```shell
node dist/cli.js http://127.0.0.1:30141 \
  --name "Pi Web" \
  --server-port 30141 \
  --server-command "pi-web --hostname 127.0.0.1 --port 30141 --no-open" \
  --hide-title-bar \
  --traffic-light-x 2 \
  --traffic-light-y 6 \
  --drag-region-height 10 \
  --targets dmg
```

## Fork Maintenance Boundary

The CLI enhancement facade delegates to contracts, option parsing, server validation and window overrides under `bin/extensions/managed-local-app/`. The config loader dispatches extension fields once; upstream numeric validation and origin capability generation remain authoritative for upstream behavior.

The native implementation lives in the `src-tauri/extensions/pake-enhancements` workspace crate. The application retains a runtime adapter after single-instance registration and a window-builder adapter shared by every window. Flattened configuration preserves the existing JSON fields. Window settings work independently of the optional `managed-server` feature; its dialog and process-management dependencies are enabled only for managed builds.

Application recipes and runner targets live in `.github/managed-local-apps.json`. The release workflow derives its matrix and expected artifact filenames from this data. Add another application through a recipe rather than editing the builder. Existing identifiers and release names stay stable.

All upstream tests are retained. The enhancement suite has 12 TypeScript cases and four Rust process-lifecycle cases. `tests/integration/managed-local-app.mjs` uses one generic native fixture for ordinary builds, concurrent managed startup, CSP popups, minimized-window service survival and cleanup on exit. Pi Web injection tests are maintained separately.

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
```

The Enhancement Compatibility workflow runs the four feature configurations and Clippy on macOS, Linux, Windows x64 and Windows ARM64, then runs the native fixture. The ARM64 job also verifies a real MSI's platform metadata. Linux native acceptance uses Xvfb and a D-Bus session.
