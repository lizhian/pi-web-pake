# Pi Web Desktop for macOS

A lightweight Apple Silicon desktop launcher for a user-managed
[Pi Web](https://github.com/agegr/pi-web) installation. The app contains no
Node.js, pi, or pi-web runtime.

## Requirements

- macOS on Apple Silicon
- Node.js 22.19.0 or newer
- A global Pi Web installation available as `pi-web` in the login shell

```bash
npm install -g @agegr/pi-web@latest
```

## Behavior

- Reuses a valid Pi Web server already listening on `127.0.0.1:30141`.
- Otherwise starts `pi-web --hostname 127.0.0.1 --port 30141 --no-open` through
  the user's login shell.
- Waits for Pi Web to answer before creating the desktop window.
- Uses Pake's hidden-title-bar window style with no native title text.
- Keeps a 10 px draggable strip at the top of the Pi Web window.
- Hiding or closing the window leaves Pi Web running.
- Quitting the app stops Pi Web only when this app started that process.
- Rejects an unrelated service occupying port 30141.
- Preserves `PI_WEB_PASSWORD`; password-protected Pi Web instances use the
  WebView's standard HTTP authentication prompt.

Node.js, pi, and pi-web remain outside the application bundle, so normal user
installation and upgrade commands continue to work.

## Build

```bash
pnpm install
pnpm tauri build --target aarch64-apple-darwin
```

The build is based on [Pake](https://github.com/tw93/Pake) and remains subject
to Pake's GPL-3.0-or-later license and license exception.
