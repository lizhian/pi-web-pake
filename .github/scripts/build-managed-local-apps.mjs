import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const APPS = [
  {
    slug: "deepseek-harness",
    name: "DeepSeek Harness",
    identifier: "com.lizhian.dshweb",
    url: "http://127.0.0.1:3080",
    port: "3080",
    command: "dsh --profile web --no-open --host 127.0.0.1 --port 3080",
    dragRegionHeight: "20",
    macIcon: "src-tauri/icons/dsh_web.icns",
    desktopIcon: "src-tauri/icons/dsh_web.png",
  },
  {
    slug: "pi-web",
    name: "Pi Web",
    identifier: "com.lizhian.piweb",
    url: "http://127.0.0.1:30141",
    port: "30141",
    command: "pi-web --hostname 127.0.0.1 --port 30141 --no-open",
    dragRegionHeight: "10",
    macIcon: "src-tauri/icons/pi_web.icns",
    desktopIcon: "src-tauri/icons/pi_web.png",
  },
];

const VALID_PLATFORMS = new Set(["macos", "windows", "linux"]);
const VALID_ARCHITECTURES = new Set(["x64", "arm64"]);

function requireEnvironment(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${name} has an invalid value: ${value}`);
  }
  return value;
}

const platform = requireEnvironment("PAKE_BUILD_PLATFORM");
const architecture = requireEnvironment("PAKE_BUILD_ARCH");
const appSlug = requireEnvironment("PAKE_BUILD_APP");
const releaseTag = requireEnvironment("PAKE_RELEASE_TAG", /^v\d{8}$/);
const appVersion = requireEnvironment("PAKE_APP_VERSION", /^\d+\.\d+\.\d+$/);
const targets = requireEnvironment("PAKE_BUILD_TARGETS")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);
const planOnly = process.argv.includes("--plan");

if (!VALID_PLATFORMS.has(platform)) {
  throw new Error(`Unsupported PAKE_BUILD_PLATFORM: ${platform}`);
}
if (!VALID_ARCHITECTURES.has(architecture)) {
  throw new Error(`Unsupported PAKE_BUILD_ARCH: ${architecture}`);
}
if (targets.length === 0) {
  throw new Error("PAKE_BUILD_TARGETS must contain at least one target.");
}
const selectedApp = APPS.find((app) => app.slug === appSlug);
if (!selectedApp) {
  throw new Error(`Unsupported PAKE_BUILD_APP: ${appSlug}`);
}

const releaseDirectory = path.resolve("release");
if (!planOnly) {
  fs.mkdirSync(releaseDirectory, { recursive: true });
}

function buildArguments(app, target) {
  const icon = platform === "macos" ? app.macIcon : app.desktopIcon;
  const args = [
    app.url,
    "--name",
    app.name,
    "--identifier",
    app.identifier,
    "--icon",
    icon,
    "--app-version",
    appVersion,
    "--server-port",
    app.port,
    "--server-command",
    app.command,
    "--server-timeout",
    "30",
  ];

  if (platform === "macos") {
    args.push(
      "--hide-title-bar",
      "--traffic-light-x",
      "2",
      "--traffic-light-y",
      "6",
    );
  } else {
    args.push("--hide-window-decorations");
  }

  args.push(
    "--drag-region-height",
    app.dragRegionHeight,
    "--targets",
    target,
    "--json",
  );
  return args;
}

function copyArtifacts(app, result) {
  if (
    !result.ok ||
    !Array.isArray(result.outputs) ||
    result.outputs.length === 0
  ) {
    throw new Error(
      result.error?.message || `Pake returned no artifacts for ${app.name}.`,
    );
  }

  for (const artifact of result.outputs) {
    const sourcePath = path.resolve(artifact.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Pake reported a missing artifact: ${sourcePath}`);
    }

    const extension = path.extname(sourcePath);
    if (!extension) {
      throw new Error(`Artifact has no file extension: ${sourcePath}`);
    }

    const destination = path.join(
      releaseDirectory,
      `${app.slug}-${releaseTag}-${platform}-${architecture}${extension}`,
    );
    if (fs.existsSync(destination)) {
      throw new Error(`Duplicate release artifact: ${destination}`);
    }

    fs.copyFileSync(sourcePath, destination);
    process.stdout.write(`Prepared ${destination}\n`);
  }
}

for (const app of [selectedApp]) {
  for (const target of targets) {
    const args = buildArguments(app, target);

    if (planOnly) {
      process.stdout.write(
        `${JSON.stringify({ app: app.slug, platform, architecture, target, args })}\n`,
      );
      continue;
    }

    process.stdout.write(
      `Building ${app.name} for ${platform}/${architecture} (${target})\n`,
    );
    const build = spawnSync(process.execPath, ["dist/cli.js", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });

    if (build.stderr) {
      process.stderr.write(build.stderr);
    }
    if (build.error) {
      throw build.error;
    }

    let result;
    try {
      result = JSON.parse(build.stdout);
    } catch {
      throw new Error(
        `Pake returned invalid JSON for ${app.name}: ${build.stdout.trim()}`,
      );
    }

    if (build.status !== 0) {
      throw new Error(
        result.error?.message ||
          `Pake exited with status ${build.status} for ${app.name}.`,
      );
    }
    copyArtifacts(app, result);
  }
}
