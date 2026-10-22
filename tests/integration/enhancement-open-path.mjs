// Native acceptance for the generic opt-in, independent of managed servers.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("Native opener acceptance requires macOS.");
}
const repo = fileURLToPath(new URL("../../", import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "pake-open-path-"));
const directory = path.join(root, ".agents 中文 project");
const file = path.join(directory, ".hidden 文档.txt");
const reports = new Map();
const servers = [];
const identities = [];
let attackerOrigin;
let app;
let appError;

function page(mode, role) {
  return `<!doctype html><meta charset="utf-8"><title>Native opener probe</title><script>
(async () => {
  const check = async args => {
    try { await window.__TAURI__.core.invoke("plugin:opener|open_path", args); return "allowed"; }
    catch (error) { return "denied: " + String(error); }
  };
  const results = {
    file: await check({path: ${JSON.stringify(file)}}),
    directory: await check({path: ${JSON.stringify(directory)}}),
    explicitApp: await check({path: ${JSON.stringify(file)}, with: "TextEdit"})
  };
  await fetch("/report", {method:"POST", body:JSON.stringify({mode:${JSON.stringify(mode)}, role:${JSON.stringify(role)}, ...results})});
  ${role === "entry" ? `location.replace(${JSON.stringify(attackerOrigin + "/?mode=" + mode)});` : ""}
})().catch(error => fetch("/report", {method:"POST", body:JSON.stringify({mode:${JSON.stringify(mode)}, role:${JSON.stringify(role)}, error:String(error)})}));
</script>`;
}

async function serve(role) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/report") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const report = JSON.parse(body);
      reports.set(`${report.mode}-${report.role}`, report);
      response.end("ok");
    } else {
      response.setHeader("content-type", "text/html");
      response.end(page(url.searchParams.get("mode"), role));
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function build(args, cwd, logPath) {
  const log = await fs.open(logPath, "w");
  let stdout = "";
  try {
    const compiler = spawn(
      process.execPath,
      [path.join(repo, "dist/cli.js"), ...args],
      {
        cwd,
        env: {
          ...process.env,
          CARGO_TARGET_DIR:
            process.env.CARGO_TARGET_DIR || path.join(repo, "src-tauri/target"),
        },
        stdio: ["ignore", "pipe", log.fd],
      },
    );
    compiler.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const [code] = await once(compiler, "close");
    assert.equal(code, 0, `${stdout}\n${await fs.readFile(logPath, "utf8")}`);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.outputs.length, 1);
    return result.outputs[0].path;
  } finally {
    await log.close();
  }
}

async function stopApp() {
  if (!app?.pid || app.exitCode !== null || app.signalCode !== null) return;
  const stopped = once(app, "exit");
  app.kill("SIGTERM");
  const timeout = setTimeout(() => app.kill("SIGKILL"), 5000);
  try {
    await stopped;
  } finally {
    clearTimeout(timeout);
  }
}

try {
  await fs.mkdir(directory);
  await fs.writeFile(file, "Pake generic opener verification.\n");
  attackerOrigin = await serve("attacker");
  const entryOrigin = await serve("entry");
  for (const enabled of [false, true]) {
    const mode = enabled ? "enabled" : "disabled";
    const output = path.join(root, mode);
    await fs.mkdir(output);
    const name = `PakeOpenProbe-${process.pid}-${mode}`;
    const identifier = `com.pake.open-probe-${process.pid}-${mode}`;
    identities.push(name, identifier);
    const args = [
      `${entryOrigin}/?mode=${mode}`,
      "--name",
      name,
      "--identifier",
      identifier,
      "--icon",
      path.join(repo, "src-tauri/icons/icon.png"),
      "--targets",
      "app",
      "--debug",
      "--json",
      "--no-restore-last-url",
      "--hide-on-close",
      "false",
      "--activation-shortcut",
      "",
    ];
    if (enabled) args.push("--allow-open-path");
    console.log(`Building ordinary opener fixture (${mode}); logs: ${output}`);
    const artifact = await build(args, output, path.join(output, "build.log"));
    const bundle = path.join(output, name + ".app");
    assert.equal(await fs.realpath(artifact), await fs.realpath(bundle));
    const binary = execFileSync(
      "/usr/libexec/PlistBuddy",
      [
        "-c",
        "Print :CFBundleExecutable",
        path.join(bundle, "Contents/Info.plist"),
      ],
      { encoding: "utf8" },
    ).trim();
    const executable = path.join(bundle, "Contents/MacOS", binary);
    assert.equal(
      execFileSync("lipo", ["-archs", executable], { encoding: "utf8" }).trim(),
      process.arch === "arm64" ? "arm64" : "x86_64",
    );
    const nativeLog = await fs.open(path.join(output, "app.log"), "w");
    try {
      appError = undefined;
      app = spawn(executable, [], {
        cwd: output,
        stdio: ["ignore", nativeLog.fd, nativeLog.fd],
      });
      app.once("error", (error) => {
        appError = error;
      });
    } finally {
      await nativeLog.close();
    }
    const deadline = Date.now() + 45_000;
    while (!reports.has(`${mode}-attacker`) && Date.now() < deadline) {
      assert.ifError(appError);
      assert.equal(app.exitCode, null, `App exited early; logs: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const trusted = reports.get(`${mode}-entry`);
    const untrusted = reports.get(`${mode}-attacker`);
    assert.ok(trusted, `Entry page did not report; logs: ${output}`);
    assert.ok(untrusted, `Cross-origin page did not report; logs: ${output}`);
    assert.equal(trusted.error, undefined);
    assert.equal(untrusted.error, undefined);
    if (enabled) {
      assert.equal(trusted.file, "allowed", "Entry file open");
      assert.equal(trusted.directory, "allowed", "Entry directory open");
    } else {
      assert.match(trusted.file, /^denied: .*not allowed/i);
      assert.match(trusted.directory, /^denied: .*not allowed/i);
    }
    assert.match(trusted.explicitApp, /^denied: .*not allowed/i);
    for (const result of [
      untrusted.file,
      untrusted.directory,
      untrusted.explicitApp,
    ]) {
      assert.match(result, /^denied: .*not allowed/i);
    }
    await fs.writeFile(
      path.join(output, "reports.json"),
      JSON.stringify({ trusted, untrusted }, null, 2),
    );
    await stopApp();
    console.log(`Native opener ${mode}: PASS`);
  }
  console.log(`Native opener acceptance passed; bundles and logs: ${root}`);
} finally {
  await stopApp();
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  for (const identity of identities) {
    for (const parent of ["Application Support", "Caches", "WebKit"]) {
      await fs.rm(path.join(os.homedir(), "Library", parent, identity), {
        recursive: true,
        force: true,
      });
    }
  }
}
