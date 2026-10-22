import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const recipes = JSON.parse(
  fs.readFileSync(
    new URL("../managed-local-apps.json", import.meta.url),
    "utf8",
  ),
);

if (
  !Array.isArray(recipes.apps) ||
  !recipes.apps.length ||
  !Array.isArray(recipes.builds) ||
  !recipes.builds.length
) {
  throw new Error(
    "Managed app recipes require applications and build targets.",
  );
}

recipes.apps = recipes.apps.map((recipe) =>
  JSON.parse(
    fs.readFileSync(new URL(`../../${recipe}`, import.meta.url), "utf8"),
  ),
);

export function createBuildPlans(app, build, releaseTag, appVersion) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug) ||
    !/^v\d{8}$/.test(releaseTag) ||
    !/^\d+\.\d+\.\d+$/.test(appVersion)
  ) {
    throw new Error("Invalid app slug or release version.");
  }
  if (!["x64", "arm64"].includes(build.arch))
    throw new Error(`Unsupported architecture: ${build.arch}`);
  const formats = {
    macos: { intel: "dmg", apple: "dmg" },
    windows: { x64: "msi", arm64: "msi" },
    linux: {
      deb: "deb",
      appimage: "AppImage",
      "deb-arm64": "deb",
      "appimage-arm64": "AppImage",
    },
  }[build.platform];
  const targets = build.pake_targets
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!formats || !targets.length)
    throw new Error(`Unsupported build platform or targets: ${build.platform}`);
  return targets.map((target) => {
    const extension = formats[target];
    if (!extension)
      throw new Error(`Unsupported target ${target} for ${build.platform}`);
    const args = [
      app.url,
      "--name",
      app.name,
      "--identifier",
      app.identifier,
      "--icon",
      build.platform === "macos" ? app.macIcon : app.desktopIcon,
      "--app-version",
      appVersion,
      "--server-port",
      app.port,
      "--server-command",
      app.command,
      "--server-timeout",
      "30",
    ];
    if (build.platform === "macos")
      args.push(
        "--hide-title-bar",
        "--traffic-light-x",
        app.trafficLightX,
        "--traffic-light-y",
        app.trafficLightY,
      );
    else args.push("--hide-window-decorations");
    args.push(
      "--drag-region-height",
      app.dragRegionHeight,
      ...(app.commonArgs ?? []),
      ...(app.platformArgs?.[build.platform] ?? []),
      "--targets",
      target,
      "--json",
    );
    return {
      app: app.slug,
      platform: build.platform,
      architecture: build.arch,
      target,
      args,
      filename: `${app.slug}-${releaseTag}-${build.platform}-${build.arch}.${extension}`,
    };
  });
}

export function expectedAssets(releaseTag) {
  const names = recipes.apps.flatMap((app) =>
    recipes.builds.flatMap((build) =>
      createBuildPlans(app, build, releaseTag, "1.0.0").map(
        (plan) => plan.filename,
      ),
    ),
  );
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate planned release assets.");
  return names.sort();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [action, releaseTag] = process.argv.slice(2);
  if (action === "--matrix") {
    expectedAssets("v20000101");
    process.stdout.write(
      JSON.stringify({
        include: recipes.apps.flatMap((app) =>
          recipes.builds.map((build) => ({ app: app.slug, ...build })),
        ),
      }) + "\n",
    );
  } else if (action === "--verify-assets") {
    const expected = expectedAssets(releaseTag);
    const actual = fs.readdirSync("release").sort();
    if (
      JSON.stringify(actual) !== JSON.stringify(expected) ||
      actual.some(
        (name) =>
          !fs.statSync(path.join("release", name)).isFile() ||
          fs.statSync(path.join("release", name)).size === 0,
      )
    ) {
      throw new Error(
        `Release artifacts do not match the build plan. Expected: ${expected.join(", ")}; found: ${actual.join(", ")}`,
      );
    }
    process.stdout.write(`Validated ${expected.length} release assets.\n`);
  } else throw new Error(`Unsupported planning action: ${action}`);
}
