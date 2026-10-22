// One native fixture for ordinary builds, managed startup and window integration.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyBuildOutput } from "../helpers/build-output.js";

const script = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.argv[2] === "--serve") {
  const port = Number(process.argv[3]);
  const directory = process.argv[4];
  await fs.appendFile(path.join(directory, "starts"), `${process.pid}\n`);
  await delay(1500);
  http
    .createServer(async (request, response) => {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname === "/report") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const report = JSON.parse(body);
        await fs.writeFile(
          path.join(directory, report.tag + ".json"),
          JSON.stringify(report),
        );
        response.end("ok");
      } else if (url.pathname === "/action") {
        response.end(
          await fs
            .readFile(path.join(directory, "action"), "utf8")
            .catch(() => "wait"),
        );
      } else if (url.pathname === "/probe.js") {
        response.setHeader("content-type", "application/javascript");
        response.end(`
(async () => {
  const errors = [];
  addEventListener("error", event => errors.push(event.message));
  if (document.readyState === "loading") await new Promise(resolve => addEventListener("DOMContentLoaded", resolve, {once:true}));
  await new Promise(resolve => setTimeout(resolve, 200));
  const current = window.__TAURI__.window.getCurrentWindow();
  const report = async tag => fetch("/report", {method:"POST", body:JSON.stringify({tag,
    height: document.getElementById("pake-top-dom") ? getComputedStyle(document.getElementById("pake-top-dom")).height : null,
    config: window.pakeConfig, label: current.label, errors,
    platform: navigator.platform, userAgent: navigator.userAgent
  })});
  await window.__TAURI__.core.invoke("set_zoom", {percent:100});
  const enhanced = window.pakeConfig.drag_region_height === 14;
  if (location.pathname === "/csp") {
    await report("popup");
    await current.close();
    return;
  }
  if (enhanced) window.open("/csp", "enhancement-probe");
  await report("main");
  while (true) {
    const action = await (await fetch("/action", {cache:"no-store"})).text();
    if (action === "minimize") { await current.minimize(); await report("minimized"); }
    if (action === "close") { await current.close(); return; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
})().catch(async error => fetch("/report", {method:"POST", body:JSON.stringify({tag:"error", error:String(error)})}));
`);
      } else if (url.pathname === "/health") response.end("ready");
      else {
        response.setHeader("content-type", "text/html");
        if (url.pathname === "/csp")
          response.setHeader(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'none'",
          );
        response.end(
          '<!doctype html><meta charset="utf-8"><title>Enhancement probe</title><script src="/probe.js"></script>',
        );
      }
    })
    .listen(port, "127.0.0.1");
} else {
  const repo = process.cwd();
  const cli = path.resolve(process.env.PAKE_TEST_CLI || "dist/cli.js");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pake-native-enhancement-"),
  );
  const children = [];
  async function waitFor(predicate, description, timeout = 45_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (
        await fs.access(path.join(root, "managed", "error.json")).then(
          () => true,
          () => false,
        )
      ) {
        throw new Error(
          await fs.readFile(path.join(root, "managed", "error.json"), "utf8"),
        );
      }
      if (await predicate()) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${description}; logs: ${root}`);
  }
  async function listening(port) {
    return new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.setTimeout(500);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
  async function freePort() {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  }
  async function run(command, args, options = {}) {
    const logPath = path.join(root, `build-${Date.now()}.log`);
    const log = await fs.open(logPath, "w");
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", log.fd],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    await log.close();
    assert.equal(
      code,
      0,
      `${command} failed (${code}); log: ${logPath}\n${stdout}\n${code === 0 ? "" : await fs.readFile(logPath, "utf8")}`,
    );
    return stdout;
  }
  function launch(executable, directory) {
    const child = spawn(executable, [], {
      cwd: directory,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      stderr += String(error);
    });
    children.push(child);
    return { child, diagnostics: () => stderr };
  }
  function quote(value) {
    return process.platform === "win32"
      ? `"${value}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  }
  try {
    for (const managed of [false, true]) {
      const stage = managed ? "managed" : "ordinary";
      const directory = path.join(root, stage);
      await fs.mkdir(directory);
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      let external;
      if (!managed) {
        external = spawn(
          process.execPath,
          [script, "--serve", String(port), directory],
          { stdio: "ignore" },
        );
        children.push(external);
        await waitFor(() => listening(port), "ordinary fixture server");
      }
      const identifier = `com.pake.enhancement-${stage}-${process.pid}`;
      const name = `pake-probe-${stage}`;
      const args = [
        cli,
        url,
        "--name",
        name,
        "--identifier",
        identifier,
        "--debug",
        "--json",
        "--no-restore-last-url",
        "--hide-on-close",
        "false",
      ];
      if (process.platform === "darwin") args.push("--targets", "app");
      else if (process.platform === "win32")
        args.push("--targets", process.arch, "--keep-binary");
      else args.push("--no-bundle");
      if (managed) {
        const command = [
          process.execPath,
          script,
          "--serve",
          String(port),
          directory,
        ]
          .map(quote)
          .join(" ");
        args.push(
          "--server-port",
          String(port),
          "--server-command",
          command,
          "--server-timeout",
          "15",
          "--drag-region-height",
          "14",
          "--new-window",
        );
        if (process.platform === "darwin")
          args.push(
            "--hide-title-bar",
            "--traffic-light-x",
            "2",
            "--traffic-light-y",
            "6",
          );
        else args.push("--hide-window-decorations");
      }
      console.log(`Building ${stage} native fixture...`);
      const stdout = await run(process.execPath, args, {
        cwd: directory,
        env: process.env,
      });
      const result = JSON.parse(stdout);
      assert.equal(result.ok, true);
      const expected = path.join(
        directory,
        name +
          (process.platform === "darwin"
            ? ".app"
            : process.platform === "win32"
              ? ".exe"
              : "-binary"),
      );
      const expectedOutputs =
        process.platform === "win32"
          ? [expected, path.join(directory, `${name}.msi`)]
          : [expected];
      assert.equal(result.outputs.length, expectedOutputs.length);
      for (const artifact of expectedOutputs)
        verifyBuildOutput(0, stdout, artifact);
      let executable = expected;
      if (process.platform === "darwin") {
        const binary = execFileSync(
          "/usr/libexec/PlistBuddy",
          [
            "-c",
            "Print :CFBundleExecutable",
            path.join(expected, "Contents/Info.plist"),
          ],
          { encoding: "utf8" },
        ).trim();
        executable = path.join(expected, "Contents/MacOS", binary);
        const arch = execFileSync("lipo", ["-archs", executable], {
          encoding: "utf8",
        }).trim();
        assert.equal(arch, process.arch === "arm64" ? "arm64" : "x86_64");
      }
      const app = launch(executable, directory);
      if (managed) {
        await waitFor(
          () =>
            fs.access(path.join(directory, "starts")).then(
              () => true,
              () => false,
            ),
          "first server start",
        );
        const second = launch(executable, directory);
        await waitFor(
          () =>
            second.child.exitCode !== null || second.child.signalCode !== null,
          "second instance exit",
        );
        assert.equal(second.child.exitCode, 0, second.diagnostics());
      }
      await waitFor(async () => {
        assert.equal(app.child.exitCode, null, app.diagnostics());
        return fs.access(path.join(directory, "main.json")).then(
          () => true,
          () => false,
        );
      }, `${stage} main page`);
      if (managed) {
        await waitFor(
          () =>
            fs.access(path.join(directory, "popup.json")).then(
              () => true,
              () => false,
            ),
          "CSP popup",
        );
        for (const tag of ["main", "popup"]) {
          const report = JSON.parse(
            await fs.readFile(path.join(directory, tag + ".json")),
          );
          assert.equal(
            report.height,
            "14px",
            `${tag} drag region: ${JSON.stringify(report)}`,
          );
          if (process.platform === "darwin")
            assert.equal(report.config.traffic_light_x, 2);
        }
        await fs.writeFile(path.join(directory, "action"), "minimize");
        await waitFor(
          () =>
            fs.access(path.join(directory, "minimized.json")).then(
              () => true,
              () => false,
            ),
          "window minimization",
        );
        assert.equal(await (await fetch(url + "/health")).text(), "ready");
        assert.equal(
          (await fs.readFile(path.join(directory, "starts"), "utf8"))
            .trim()
            .split("\n").length,
          1,
        );
      }
      await fs.writeFile(path.join(directory, "action"), "close");
      await waitFor(
        () => app.child.exitCode !== null || app.child.signalCode !== null,
        `${stage} app exit`,
      );
      assert.equal(app.child.exitCode, 0, app.diagnostics());
      if (managed)
        await waitFor(
          async () => !(await listening(port)),
          "owned server cleanup",
        );
      else {
        assert.equal(await listening(port), true);
        external.kill();
      }
      console.log(`${stage} native fixture: PASS`);
    }
    console.log(`Native enhancement acceptance passed; logs: ${root}`);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    for (const stage of ["ordinary", "managed"]) {
      const starts = await fs
        .readFile(path.join(root, stage, "starts"), "utf8")
        .catch(() => "");
      for (const line of starts.trim().split("\n").filter(Boolean)) {
        try {
          process.kill(Number(line));
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
  }
}
