// Run with Node and an installed Playwright: node tests/browser/style-injection.mjs
// PAKE_PLAYWRIGHT_MODULE / PAKE_BROWSER_EXECUTABLE can select an existing runtime.
// PAKE_STYLE_SOURCE selects a prior helper for regression red runs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, before, after } from "node:test";

const source = await fs.readFile(
  process.env.PAKE_STYLE_SOURCE || "src-tauri/src/inject/styles.js",
  "utf8",
);
const { chromium } = await import(
  process.env.PAKE_PLAYWRIGHT_MODULE
    ? pathToFileURL(path.resolve(process.env.PAKE_PLAYWRIGHT_MODULE)).href
    : "playwright"
);
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PAKE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PAKE_BROWSER_EXECUTABLE }
      : {}),
  });
});
after(async () => browser?.close());

async function withPage(strict, run) {
  const page = await browser.newPage();
  try {
    // Every request is fulfilled locally. Fixtures never contact a real site.
    await page.route("**/*", (route) => {
      const isCss = route.request().url().endsWith("theme.css");
      return route.fulfill({
        status: 200,
        contentType: isCss ? "text/css" : "text/html",
        headers: strict
          ? { "Content-Security-Policy": "style-src 'none'" }
          : {},
        body: isCss
          ? "body { color: rgb(1, 2, 3); }"
          : "<!doctype html><html><head></head><body>Find this sample text</body></html>",
      });
    });
    await page.goto("https://pake-style.test/");
    await page.evaluate(source);
    await run(page);
  } finally {
    await page.close();
  }
}

for (const css of [
  '/* theme */@import "theme.css";',
  '@IMPORT "theme.css";',
  '@charset "UTF-8";@import "theme.css";',
  '@\\69mport "theme.css";',
]) {
  test(`preserves imported CSS: ${css}`, () =>
    withPage(false, async (page) => {
      await page.evaluate((text) => window.__PAKE_INJECT_STYLE__(text), css);
      await page.waitForFunction(
        () => getComputedStyle(document.body).color === "rgb(1, 2, 3)",
        null,
        { timeout: 2000 },
      );
      assert.equal(
        await page.evaluate(() => document.adoptedStyleSheets.length),
        0,
      );
    }));
}

test("preserves file order across plain and imported custom CSS", () =>
  withPage(false, async (page) => {
    const color = await page.evaluate(() => {
      window.__PAKE_INJECT_STYLE__("body { color: red; }");
      window.__PAKE_INJECT_STYLE__(
        '@import "theme.css"; body { color: blue; }',
      );
      return getComputedStyle(document.body).color;
    });
    assert.equal(color, "rgb(0, 0, 255)");
  }));

test("proves CSP blocks DOM styles while the fallback applies", () =>
  withPage(true, async (page) => {
    const result = await page.evaluate(() => {
      const blocked = document.createElement("style");
      blocked.textContent = "body { color: blue; }";
      document.head.append(blocked);
      const before = getComputedStyle(document.body).color;
      const blockedSheet = blocked.sheet;
      blocked.remove();
      window.__PAKE_INJECT_STYLE__("body { color: red; }", "pake-test-style");
      return {
        before,
        blockedSheet,
        after: getComputedStyle(document.body).color,
        elements: document.querySelectorAll("style").length,
      };
    });
    assert.deepEqual(result, {
      before: "rgb(0, 0, 0)",
      blockedSheet: null,
      after: "rgb(255, 0, 0)",
      elements: 0,
    });
  }));

test("preserves existing adopted sheets and recreates removed cache entries", () =>
  withPage(true, async (page) => {
    const result = await page.evaluate(() => {
      const existing = new CSSStyleSheet();
      existing.replaceSync("body { font-size: 23px; }");
      document.adoptedStyleSheets = [existing];
      const first = window.__PAKE_INJECT_STYLE__(
        "body { color: red; }",
        "pake-test-style",
      );
      const repeated = window.__PAKE_INJECT_STYLE__(
        "body { color: red; }",
        "pake-test-style",
      );
      const preserved = document.adoptedStyleSheets.includes(existing);
      document.adoptedStyleSheets = [existing];
      const recreated = window.__PAKE_INJECT_STYLE__(
        "body { color: red; }",
        "pake-test-style",
      );
      return {
        preserved,
        same: first === repeated,
        recreated: first !== recreated,
        count: document.adoptedStyleSheets.length,
        color: getComputedStyle(document.body).color,
      };
    });
    assert.deepEqual(result, {
      preserved: true,
      same: true,
      recreated: true,
      count: 2,
      color: "rgb(255, 0, 0)",
    });
  }));

test("keeps strict-CSP imports visibly unsupported instead of dropping rules", () =>
  withPage(true, async (page) => {
    const result = await page.evaluate(() => {
      const css = '/* theme */@IMPORT "theme.css"; body { color: red; }';
      const style = window.__PAKE_INJECT_STYLE__(css);
      return {
        tag: style.tagName,
        text: style.textContent,
        sheet: style.sheet,
        adopted: document.adoptedStyleSheets.length,
      };
    });
    assert.deepEqual(result, {
      tag: "STYLE",
      text: '/* theme */@IMPORT "theme.css"; body { color: red; }',
      sheet: null,
      adopted: 0,
    });
  }));

test("renders the actual Find panel under strict CSP", () =>
  withPage(true, async (page) => {
    await page.evaluate(() => {
      window.pakeConfig = { enable_find: true };
    });
    await page.evaluate(
      await fs.readFile("src-tauri/src/inject/find.js", "utf8"),
    );
    const result = await page.evaluate(() => {
      window.pakeFind.open();
      const panel = document.querySelector("#pake-find-panel");
      return {
        exists: !!panel,
        position: panel && getComputedStyle(panel).position,
      };
    });
    assert.deepEqual(result, { exists: true, position: "fixed" });
  }));

test("does not treat strings, comments or escaped selectors as import rules", () =>
  withPage(true, async (page) => {
    const color = await page.evaluate(() => {
      document.body.className = "@import";
      window.__PAKE_INJECT_STYLE__(
        '/* @import */ .\\@import { color: red; } body::before { content: "@import"; }',
      );
      return getComputedStyle(document.body).color;
    });
    assert.equal(color, "rgb(255, 0, 0)");
  }));
