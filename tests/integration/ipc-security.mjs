// Native WebView coverage for origin ACLs and the disclosed download payload.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

if (process.platform !== "darwin") {
  throw new Error("This native IPC fixture currently requires macOS.");
}
const repo = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), "pake-ipc-security-"));
const fixture = path.join(root, "fixture");
const downloads = path.join(root, "downloads");
const identifier = `com.pake.ipc-probe-${process.pid}`;
const reports = new Map();
const downloadRequests = [];
const popupRequests = [];
const popupReports = new Map();
const delegatedPopups = [];
let loadingReport;
let finishLoadingPopup;
const popupPaths = [
  "/popup/history",
  "/popup/project",
  "/popup/session",
  "/popup/link",
  "/popup/implicit",
  "/popup/loading",
  "/popup/plain",
  "/popup/two-stage",
];
let app;
let attackerOrigin;
let entryOrigin;

function page(stage, origin) {
  return `<!doctype html><meta charset="utf-8"><title>Pake IPC security probe</title>
<body>Testing ${stage} origin permissions<main><section id="player"><video></video><button>Pause</button></section></main><script>
(async () => {
  if (${JSON.stringify(stage)} === "popup") {
    // Run before DOMContentLoaded and the adapter to observe the first page script.
    await fetch("/popup-report", {method:"POST", body:JSON.stringify({
      path: location.pathname, openerIsNull: window.opener === null,
      rootStyle: document.documentElement.style.backgroundColor
    })});
    return;
  }
  const invoke = window.__TAURI__.core.invoke;
  const check = async (command, args) => {
    try { await invoke(command, args); return "allowed"; }
    catch (error) { return "denied: " + String(error); }
  };
  const results = {};
  results.download = await check("download_file", {params: {
    url: ${JSON.stringify(origin + "/payload")}, filename: ${JSON.stringify(stage + ".txt")},
    user_agent: navigator.userAgent, page_url: location.href
  }});
  results.userAgent = navigator.userAgent;
  results.zoom = await check("set_zoom", {percent: 100});
  results.closeNotification = await check("close_notification", {id: "pake-probe-not-delivered"});
  results.window = await check("plugin:window|is_fullscreen", {label: "pake"});
  results.printShim = String(window.print).includes("plugin:webview|print");
  // A missing label fails after the ACL check without opening a print panel.
  results.print = await check("plugin:webview|print", {label: "pake-probe-missing-webview"});
  ${
    stage === "entry"
      ? `results.traversal = await check("download_file", {params: {
    url: ${JSON.stringify(origin + "/payload")}, filename: "../outside.txt"
  }});`
      : ""
  }
  ${
    stage === "attacker"
      ? `
  await new Promise(resolve => document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", resolve, {once:true}) : resolve());
  await new Promise(resolve => setTimeout(resolve, 250));
  for (const [url, filename] of [["/native.txt", "native.txt"], [${JSON.stringify(entryOrigin + "/attachment")}, "native-cross.txt"]]) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const player = document.querySelector("#player");
  const parent = player.parentElement;
  try { await player.requestFullscreen(); results.fullscreen = "allowed"; }
  catch (error) { results.fullscreen = "denied: " + String(error); }
  results.layoutPreserved = player.parentElement === parent
    && document.fullscreenElement === null && !document.querySelector(".pake-fullscreen-element, .pake-fullscreen-active");
  `
      : ""
  }
  ${
    stage === "entry"
      ? `
  await new Promise(resolve => document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", resolve, {once:true}) : resolve());
  window.open("/popup/history", "_blank", "noopener,noreferrer");
  window.open("/popup/project?cwd=test", "_blank", "NoOpener = yes,width=640");
  window.open("/popup/session", "sessionReport", "noreferrer=1");
  window.open("/popup/loading", "_blank", "noopener,noreferrer");
  results.plainProxy = !!window.open("/popup/plain", "plainReport", "width=640");
  const blank = window.open("", "_blank");
  results.blankProxy = !!blank && blank !== window;
  if (blank) blank.location.href = location.origin + "/popup/two-stage";
  for (const [url, rel] of [
    ["/popup/link", "noopener noreferrer"], ["/popup/implicit", ""],
    ["/cancelled", ""], ["/cancelled-listener", ""]
  ]) {
    const anchor = document.createElement("a");
    anchor.href = url; anchor.target = "_blank"; anchor.rel = rel;
    if (url === "/cancelled") anchor.onclick = event => {
      event.preventDefault();
    };
    if (url === "/cancelled-listener") anchor.addEventListener("click", event => {
      event.preventDefault();
    });
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }
  window.open("/native-popup.txt", "_blank", "noopener,noreferrer");
  results.popupPreservesMain = location.href === ${JSON.stringify(origin + "/")};
  await new Promise(resolve => setTimeout(resolve, 500));
  `
      : ""
  }
  await fetch("/report", {method:"POST", body:JSON.stringify(results)});
  ${stage === "entry" ? `location.replace(${JSON.stringify(attackerOrigin)});` : ""}
})().catch(error => fetch("/report", {method:"POST", body:JSON.stringify({error:String(error)})}));
</script>`;
}

async function server(stage) {
  let origin;
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.startsWith("/popup/") || pathname.startsWith("/cancelled")) {
      const trusted =
        request.headers["sec-fetch-site"] !== "cross-site" ||
        request.headers["sec-fetch-user"] === "?1";
      popupRequests.push({ path: pathname, trusted });
      if (trusted && pathname === "/popup/loading") {
        // Hold the response until the parent observes the initial document.
        finishLoadingPopup = () => {
          response.writeHead(200, { "content-type": "text/html" });
          response.end(page("popup", origin));
        };
        if (loadingReport) finishLoadingPopup();
        return;
      }
      response.writeHead(trusted ? 200 : 403, { "content-type": "text/html" });
      response.end(trusted ? page("popup", origin) : "Untrusted API request");
    } else if (
      request.url === "/native.txt" ||
      request.url === "/attachment" ||
      request.url === "/native-popup.txt"
    ) {
      const names = {
        "/native.txt": "native.txt",
        "/attachment": "native-cross.txt",
        "/native-popup.txt": "popup-window.txt",
      };
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${names[request.url]}"`,
      });
      response.end("pake-native-browser-download");
    } else if (request.url === "/payload") {
      downloadRequests.push({ stage, headers: request.headers });
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("pake-native-ipc-proof");
    } else if (
      [
        "/report",
        "/popup-report",
        "/delegated-popup",
        "/loading-report",
      ].includes(request.url)
    ) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const report = JSON.parse(Buffer.concat(chunks).toString());
      if (request.url === "/loading-report") {
        loadingReport = report;
        finishLoadingPopup?.();
      } else if (request.url === "/popup-report")
        popupReports.set(report.path, report);
      else if (request.url === "/delegated-popup") delegatedPopups.push(report);
      else reports.set(stage, report);
      response.end("ok");
    } else {
      response.writeHead(200, {
        "content-type": "text/html",
        "set-cookie": [
          "pakeFixtureSession=entry; Path=/; HttpOnly; SameSite=Lax",
          "pakeWrongPath=fixture; Path=/never; HttpOnly",
        ],
      });
      response.end(page(stage, origin));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin };
}

const attacker = await server("attacker");
attackerOrigin = attacker.origin;
const entry = await server("entry");
entryOrigin = entry.origin;
try {
  await fs.mkdir(fixture);
  await fs.cp(path.join(repo, "src-tauri"), path.join(fixture, "src-tauri"), {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(path.join(repo, "src-tauri"), file);
      return (
        !["target", ".pake", "gen", ".cargo"].includes(
          relative.split(path.sep)[0],
        ) && !relative.startsWith(path.join("permissions", "autogenerated"))
      );
    },
  });
  await fs.copyFile(
    path.join(repo, "rust-toolchain.toml"),
    path.join(fixture, "rust-toolchain.toml"),
  );
  await fs.mkdir(path.join(fixture, "dist"));
  await fs.writeFile(path.join(fixture, "dist", "index.html"), "IPC fixture");
  const adapter = await fs.readFile(
    path.join(repo, "scripts/pi-web-inject.js"),
    "utf8",
  );
  await fs.writeFile(
    path.join(fixture, "src-tauri/src/inject/custom.js"),
    `
window.addEventListener("DOMContentLoaded", () => {
  const delegate = window.open;
  window.open = function(url, target, features) {
    fetch("/delegated-popup", {method:"POST", body:JSON.stringify({url, target, features})});
    const popup = delegate.call(this, url, target, features);
    if (String(url).endsWith("/popup/loading") && popup) queueMicrotask(() => {
      const initial = popup.document;
      fetch("/loading-report", {method:"POST", body:JSON.stringify({
        url: initial.URL,
        background: popup.getComputedStyle(initial.documentElement).backgroundColor,
        colorScheme: popup.getComputedStyle(initial.documentElement).colorScheme,
        bodyBackground: popup.getComputedStyle(initial.body).backgroundColor
      })});
    });
    return popup;
  };
  ${adapter}
});`,
  );
  const pake = JSON.parse(
    await fs.readFile(path.join(fixture, "src-tauri", "pake.json")),
  );
  pake.windows[0].url = entry.origin;
  pake.windows[0].url_type = "web";
  pake.windows[0].new_window = true;
  pake.download_dir = downloads;
  pake.system_tray.macos = false;
  const tauri = JSON.parse(
    await fs.readFile(path.join(fixture, "src-tauri", "tauri.conf.json")),
  );
  tauri.identifier = identifier;
  tauri.productName = "PakeSecurityProbe";
  const configDir = path.join(fixture, "src-tauri", ".pake");
  await fs.mkdir(configDir);
  await fs.writeFile(path.join(configDir, "pake.json"), JSON.stringify(pake));
  await fs.writeFile(
    path.join(configDir, "tauri.conf.json"),
    JSON.stringify(tauri),
  );

  const log = await fs.open(path.join(root, "build.log"), "w");
  console.log("Building native IPC fixture...");
  const compiler = spawn(
    "cargo",
    ["build", "--locked", "--features", "cli-build"],
    {
      cwd: path.join(fixture, "src-tauri"),
      env: {
        ...process.env,
        TAURI_CONFIG: JSON.stringify(tauri),
        CARGO_TARGET_DIR: path.join(repo, "src-tauri", "target"),
      },
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  const [exitCode] = await once(compiler, "exit");
  await log.close();
  if (exitCode !== 0) {
    console.error(await fs.readFile(path.join(root, "build.log"), "utf8"));
    throw new Error(`Native fixture build failed with exit code ${exitCode}`);
  }
  console.log("Running real macOS WebView origin probes...");
  app = spawn(path.join(repo, "src-tauri", "target", "debug", "pake"), [], {
    stdio: "ignore",
  });
  const deadline = Date.now() + 45_000;
  while (!reports.has("attacker") && Date.now() < deadline) {
    if (app.exitCode !== null)
      throw new Error(`Native app exited with ${app.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(reports.has("entry"), "configured entry page did not report");
  assert.ok(reports.has("attacker"), "cross-origin page did not report");
  const trusted = reports.get("entry");
  assert.equal(
    trusted.popupPreservesMain,
    true,
    "popup replaced the main page",
  );
  assert.equal(trusted.plainProxy, true, "ordinary window.open lost its proxy");
  assert.equal(
    trusted.blankProxy,
    true,
    "two-stage popup lost its separate proxy",
  );
  assert.ok(
    popupRequests.every((request) => request.trusted),
    "popup was rejected as a cross-site API request",
  );
  assert.equal(
    popupRequests.filter((request) => request.path.startsWith("/cancelled"))
      .length,
    0,
    "cancelled SPA link opened a window",
  );
  while (popupReports.size < popupPaths.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const pathname of popupPaths) {
    assert.equal(
      popupRequests.filter((request) => request.path === pathname).length,
      1,
      `${pathname}: expected exactly one request`,
    );
    assert.ok(
      popupReports.has(pathname),
      `${pathname}: first page script did not report`,
    );
  }
  assert.equal(
    loadingReport?.url,
    "about:blank",
    "the initial document was not observed",
  );
  assert.equal(
    loadingReport.background,
    "rgb(0, 0, 0)",
    "loading canvas is not black",
  );
  assert.equal(loadingReport.bodyBackground, "rgb(0, 0, 0)");
  assert.equal(loadingReport.colorScheme, "dark");
  assert.equal(
    popupReports.get("/popup/loading").rootStyle,
    "",
    "loading styles leaked into the destination document",
  );
  for (const pathname of popupPaths.slice(0, 6)) {
    assert.equal(
      popupReports.get(pathname).openerIsNull,
      true,
      `${pathname}: first page script retained its opener`,
    );
    const opened = delegatedPopups.find((request) =>
      request.url?.startsWith(entryOrigin + pathname),
    );
    assert.ok(
      opened,
      `${pathname}: native call did not open the destination directly`,
    );
    assert.equal(opened.target, "_blank");
    assert.doesNotMatch(opened.features, /noopener|noreferrer/i);
  }
  assert.equal(
    delegatedPopups.filter((request) => request.url === "about:blank").length,
    0,
    "adapter added an about:blank intermediary",
  );
  const untrusted = reports.get("attacker");
  const request = downloadRequests.find((item) => item.stage === "entry");
  assert.equal(request.headers["user-agent"], trusted.userAgent);
  assert.equal(request.headers.referer, entryOrigin + "/");
  assert.match(
    request.headers.cookie,
    /(?:^|; )pakeFixtureSession=entry(?:;|$)/,
  );
  assert.ok(!request.headers.cookie.includes("pakeWrongPath"));
  for (const command of [
    "download",
    "zoom",
    "window",
    "traversal",
    "closeNotification",
  ]) {
    assert.equal(trusted[command], "allowed", `configured origin: ${command}`);
  }
  for (const command of [
    "download",
    "zoom",
    "window",
    "closeNotification",
    "print",
  ]) {
    assert.match(
      untrusted[command],
      /^denied: .*not allowed/i,
      `untrusted origin: ${command}`,
    );
  }
  for (const report of [trusted, untrusted]) {
    assert.equal(report.printShim, true, "window.print is not the IPC shim");
  }
  assert.doesNotMatch(
    trusted.print,
    /not allowed/i,
    "configured origin: print",
  );
  assert.match(trusted.print, /^denied: .*webview not found/i);
  const downloadDeadline = Date.now() + 5000;
  while (Date.now() < downloadDeadline) {
    try {
      await fs.stat(path.join(downloads, "native-cross.txt"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  for (const file of ["native.txt", "native-cross.txt", "popup-window.txt"]) {
    assert.equal(
      await fs.readFile(path.join(downloads, file), "utf8"),
      "pake-native-browser-download",
    );
  }
  assert.match(untrusted.fullscreen, /^denied: .*not allowed/i);
  assert.equal(
    untrusted.layoutPreserved,
    true,
    "denied fullscreen changed the player layout",
  );
  assert.equal(
    await fs.readFile(path.join(downloads, "entry.txt"), "utf8"),
    "pake-native-ipc-proof",
  );
  assert.equal(
    await fs.readFile(path.join(downloads, "outside.txt"), "utf8"),
    "pake-native-ipc-proof",
  );
  for (const file of [
    path.join(root, "outside.txt"),
    path.join(downloads, "attacker.txt"),
  ]) {
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
  }
  console.log(
    "Native IPC PASS: direct same-origin popups load once with isolated openers and a black loading document; destination styles, links, proxies, native attachments and origin ACLs remain intact.",
  );
} finally {
  if (app && app.exitCode === null) {
    const stopped = once(app, "exit");
    app.kill("SIGTERM");
    await stopped;
  }
  await Promise.all(
    [entry, attacker].map(
      ({ server }) => new Promise((resolve) => server.close(resolve)),
    ),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(
    path.join(os.homedir(), "Library", "Application Support", identifier),
    { recursive: true, force: true },
  );
  await fs.rm(path.join(os.homedir(), "Library", "Caches", identifier), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(os.homedir(), "Library", "WebKit", identifier), {
    recursive: true,
    force: true,
  });
}
