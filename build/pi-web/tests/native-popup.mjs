// A real WKWebView scenario using the recipe's complete functional arguments.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createBuildPlans } from "../../../.github/scripts/managed-local-app-plan.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const resource = (relative) =>
  fileURLToPath(new URL(relative, import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null)
    return [child.exitCode, child.signalCode];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await once(child, "exit", { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

test(
  "native Pi Web popups load directly once, stay isolated and preserve the main URL",
  { skip: process.platform !== "darwin", timeout: 1_800_000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pake-pi-web-"));
    const reports = new Map();
    const requests = [];
    const delegates = [];
    const errors = [];
    let finish = false;
    let pending;
    let app;
    const pageScript = await fs.readFile(
      new URL("./fixtures/native-page.js", import.meta.url),
      "utf8",
    );
    const sendPage = (response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<!doctype html><meta charset="utf-8"><title>Pi Web popup probe</title><body><script src="/probe.js"></script></body>',
      );
    };
    const server = http.createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname.startsWith("/report/")) {
          let body = "";
          for await (const chunk of request) body += chunk;
          const value = JSON.parse(body);
          const tag = pathname.slice("/report/".length);
          if (tag === "error") errors.push(value);
          else if (tag === "delegate") delegates.push(value);
          else reports.set(tag === "popup" ? value.path : tag, value);
          response.end("ok");
          if (tag === "loading" && pending) sendPage(pending);
        } else if (pathname === "/finish") response.end(JSON.stringify(finish));
        else if (pathname === "/probe.js") {
          response.setHeader("content-type", "application/javascript");
          response.end(pageScript);
        } else if (pathname.startsWith("/popup/")) {
          requests.push({ pathname, site: request.headers["sec-fetch-site"] });
          if (pathname === "/popup/loading" && !reports.has("loading"))
            pending = response;
          else sendPage(response);
        } else sendPage(response);
      } catch (error) {
        errors.push(String(error));
        response.writeHead(500).end("Fixture failed");
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = String(server.address().port);
    const url = `http://127.0.0.1:${port}`;
    async function waitFor(predicate, description) {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        assert.deepEqual(errors, [], `Fixture errors; logs: ${root}`);
        assert.equal(app.exitCode, null, `App exited early; logs: ${root}`);
        if (predicate()) return;
        await delay(100);
      }
      throw new Error(`Timed out: ${description}; logs: ${root}`);
    }
    try {
      const recipe = JSON.parse(
        await fs.readFile(new URL("../recipe.json", import.meta.url), "utf8"),
      );
      const args = createBuildPlans(
        {
          ...recipe,
          name: "PakePiWebProbe",
          identifier: `com.pake.pi-web-probe-${process.pid}`,
          url,
          port,
          command: "exit 1",
        },
        {
          platform: "macos",
          arch: process.arch === "arm64" ? "arm64" : "x64",
          pake_targets: process.arch === "arm64" ? "apple" : "intel",
        },
        "v20261021",
        "26.10.21",
      )[0].args;
      args[args.indexOf("--icon") + 1] = resource("../assets/pi_web.icns");
      args[args.indexOf("--safe-domain") + 1] = `127.0.0.1:${port}`;
      args[args.indexOf("--inject") + 1] = [
        resource("./fixtures/native-observer.js"),
        resource("../scripts/pi-web-inject.css"),
        resource("../scripts/pi-web-inject.js"),
      ].join(",");
      args.push(
        "--debug",
        "--iterative-build",
        "--no-restore-last-url",
        "--hide-on-close",
        "false",
      );
      const logPath = path.join(root, "build.log");
      const log = await fs.open(logPath, "w");
      console.log(`Building Pi Web native fixture; logs: ${root}`);
      let stdout = "";
      let code;
      try {
        const compiler = spawn(
          process.execPath,
          [path.join(repo, "dist/cli.js"), ...args],
          {
            cwd: root,
            env: {
              ...process.env,
              CARGO_TARGET_DIR:
                process.env.CARGO_TARGET_DIR ||
                path.join(repo, "src-tauri/target"),
            },
            stdio: ["ignore", "pipe", log.fd],
          },
        );
        compiler.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        [code] = await once(compiler, "close");
      } finally {
        await log.close();
      }
      assert.equal(code, 0, `${stdout}\n${await fs.readFile(logPath, "utf8")}`);
      const result = JSON.parse(stdout);
      assert.equal(result.ok, true);
      assert.equal(result.outputs.length, 1);
      const bundle = path.join(root, "PakePiWebProbe.app");
      assert.equal(
        await fs.realpath(result.outputs[0].path),
        await fs.realpath(bundle),
      );
      const plist = path.join(bundle, "Contents/Info.plist");
      const binary = execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleExecutable", plist],
        { encoding: "utf8" },
      ).trim();
      const executable = path.join(bundle, "Contents/MacOS", binary);
      assert.equal(
        execFileSync("lipo", ["-archs", executable], {
          encoding: "utf8",
        }).trim(),
        process.arch === "arm64" ? "arm64" : "x86_64",
      );
      for (const key of [
        "NSCameraUsageDescription",
        "NSMicrophoneUsageDescription",
      ]) {
        assert.ok(
          execFileSync(
            "/usr/libexec/PlistBuddy",
            ["-c", `Print :${key}`, plist],
            { encoding: "utf8" },
          ).trim(),
        );
      }
      const nativeLog = await fs.open(path.join(root, "app.log"), "w");
      try {
        app = spawn(executable, [], {
          cwd: root,
          stdio: ["ignore", nativeLog.fd, nativeLog.fd],
        });
      } finally {
        await nativeLog.close();
      }
      const paths = ["/popup/direct", "/popup/implicit", "/popup/loading"];
      await waitFor(
        () =>
          reports.has("main") &&
          reports.has("loading") &&
          paths.every((p) => reports.has(p)) &&
          delegates.length === 3,
        "popup reports",
      );
      const main = reports.get("main");
      assert.equal(main.originalUrl, url + "/");
      assert.equal(main.currentUrl, main.originalUrl);
      assert.equal(main.config.new_window, true);
      assert.equal(main.config.traffic_light_x, 11);
      assert.equal(main.config.traffic_light_y, 16);
      assert.equal(main.config.drag_region_height, 10);
      for (const pathname of paths) {
        assert.equal(requests.filter((r) => r.pathname === pathname).length, 1);
        assert.notEqual(
          requests.find((r) => r.pathname === pathname).site,
          "cross-site",
        );
        assert.equal(reports.get(pathname).openerIsNull, true);
        assert.equal(reports.get(pathname).rootStyle, "");
        const delegated = delegates.find((d) => d.url === url + pathname);
        assert.ok(delegated, `Missing direct native call for ${pathname}`);
        assert.equal(delegated.target, "_blank");
        assert.doesNotMatch(delegated.features, /noopener|noreferrer/i);
      }
      assert.deepEqual(reports.get("loading"), {
        url: "about:blank",
        background: "rgb(0, 0, 0)",
        bodyBackground: "rgb(0, 0, 0)",
        colorScheme: "dark",
      });
      finish = true;
      const exited = await waitForExit(app, 10_000);
      assert.ok(exited, `App did not exit; logs: ${root}`);
      const [exitCode] = exited;
      assert.equal(exitCode, 0);
      assert.deepEqual(errors, []);
      console.log(`Pi Web native acceptance passed; bundle and logs: ${root}`);
    } finally {
      if (app && app.exitCode === null && app.signalCode === null) {
        app.kill("SIGTERM");
        if (!(await waitForExit(app, 3000))) {
          app.kill("SIGKILL");
          assert.ok(
            await waitForExit(app, 3000),
            `App did not stop; logs: ${root}`,
          );
        }
      }
      pending?.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
