import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { recipes, createBuildPlans } from "./managed-local-app-plan.mjs";

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

const selectedApp = recipes.apps.find((app) => app.slug === appSlug);
if (!selectedApp) throw new Error(`Unsupported PAKE_BUILD_APP: ${appSlug}`);
const plans = createBuildPlans(
  selectedApp,
  { platform, arch: architecture, pake_targets: targets.join(",") },
  releaseTag,
  appVersion,
);

const releaseDirectory = path.resolve("release");
if (!planOnly) {
  fs.mkdirSync(releaseDirectory, { recursive: true });
}

function copyArtifacts(plan, result) {
  if (
    !result.ok ||
    !Array.isArray(result.outputs) ||
    result.outputs.length !== 1
  ) {
    throw new Error(
      result.error?.message ||
        `Pake returned no artifacts for ${selectedApp.name}.`,
    );
  }

  for (const artifact of result.outputs) {
    const sourcePath = path.resolve(artifact.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Pake reported a missing artifact: ${sourcePath}`);
    }

    const extension = path.extname(sourcePath);
    if (extension !== path.extname(plan.filename)) {
      throw new Error(`Unexpected artifact format: ${sourcePath}`);
    }

    const destination = path.join(releaseDirectory, plan.filename);
    if (fs.existsSync(destination)) {
      throw new Error(`Duplicate release artifact: ${destination}`);
    }

    fs.copyFileSync(sourcePath, destination);
    process.stdout.write(`Prepared ${destination}\n`);
  }
}

for (const plan of plans) {
  const { args, target } = plan;

  if (planOnly) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    continue;
  }

  process.stdout.write(
    `Building ${selectedApp.name} for ${platform}/${architecture} (${target})\n`,
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
      `Pake returned invalid JSON for ${selectedApp.name}: ${build.stdout.trim()}`,
    );
  }

  if (build.status !== 0) {
    throw new Error(
      result.error?.message ||
        `Pake exited with status ${build.status} for ${selectedApp.name}.`,
    );
  }
  copyArtifacts(plan, result);
}
