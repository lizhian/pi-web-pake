import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const script = await fs.readFile(
  new URL("../../scripts/pi-web-inject.js", import.meta.url),
  "utf8",
);
export const css = await fs.readFile(
  new URL("../../scripts/pi-web-inject.css", import.meta.url),
  "utf8",
);

export async function launchBrowser() {
  const { chromium } = await import(
    process.env.PAKE_PLAYWRIGHT_MODULE
      ? pathToFileURL(path.resolve(process.env.PAKE_PLAYWRIGHT_MODULE)).href
      : "playwright"
  );
  return chromium.launch({
    headless: true,
    ...(process.env.PAKE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PAKE_BROWSER_EXECUTABLE }
      : {}),
  });
}
