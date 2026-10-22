// Run with Node and an installed Playwright. Optional runtime selectors:
// PAKE_PLAYWRIGHT_MODULE / PAKE_BROWSER_EXECUTABLE.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import {
  withPage,
  withExport,
  settle,
  metrics,
  fileMetrics,
  historyMetrics,
  script,
} from "./fixtures/layout.mjs";

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

test("updates the main titlebar across sidebar states and replacement without duplicate injection", () =>
  withPage(browser, {}, async (page) => {
    assert.equal((await metrics(page)).gutter, 80);
    for (const width of [180, 260]) {
      await page.evaluate((width) => {
        window.fixture.sidebar.style.width = `${width}px`;
      }, width);
      await settle(page);
      const result = await metrics(page);
      assert.equal(result.overflow, false);
      assert.equal(result.brand, width === 260);
    }
    await page.evaluate(() =>
      window.fixture.sidebar.style.removeProperty("width"),
    );
    for (const expanded of [false, true]) {
      await page.evaluate((expanded) => {
        window.fixture.sidebar.className = `sidebar-container sidebar-${expanded ? "open" : "closed"}`;
      }, expanded);
      await settle(page);
      assert.equal((await metrics(page)).kind, expanded ? "sidebar" : "main");
      assert.equal((await metrics(page)).mainPadding, expanded ? 0 : 80);
    }
    await page.evaluate(() => {
      const old = window.fixture.header;
      const replacement = old.cloneNode(true);
      replacement.removeAttribute("data-pi-web-titlebar");
      replacement.style.removeProperty("--pi-web-titlebar-gutter");
      old.replaceWith(replacement);
      window.fixture.header = replacement;
    });
    await settle(page);
    const before = await metrics(page);
    await page.evaluate(script);
    await settle(page);
    assert.deepEqual(await metrics(page), before);
    assert.equal(await page.locator("[data-pi-web-titlebar]").count(), 1);
    await page.locator(".sidebar-new-button").evaluate((button) => {
      button.addEventListener("click", () => {
        window.clicked = true;
      });
    });
    await page.locator(".sidebar-new-button").click();
    assert.equal(await page.evaluate(() => window.clicked), true);
  }));

test("reserves file-panel space in full-width and narrow layouts and restores the split layout", () =>
  withPage(browser, { filePanel: true, fullWidth: true }, async (page) => {
    const baseline = await page.evaluate(() => window.fixture.fileBaseline);
    const full = await fileMetrics(page);
    assert.equal(full.padding, 80);
    assert.equal(full.railLeft, 80);
    assert.deepEqual(full.header, baseline.header);
    assert.deepEqual(full.content, baseline.content);
    assert.equal(full.actionsLeft, baseline.actionsLeft);
    await page
      .getByRole("button", { name: "Expand file panel", exact: true })
      .click();
    assert.equal((await fileMetrics(page)).padding, 0);
    await page.setViewportSize({ width: 600, height: 700 });
    const narrow = await fileMetrics(page);
    assert.equal(narrow.padding, 80);
    assert.equal(narrow.content.top, narrow.header.bottom);
    assert.equal(narrow.closeRight, 600);
    await page
      .getByRole("button", { name: "Hide file panel", exact: true })
      .click();
    assert.equal((await fileMetrics(page)).padding, 0);
  }));

test("reserves desktop history space without moving content or disabling its controls", () =>
  withExport(browser, {}, async (page, baseline, initial) => {
    assert.equal(initial, "36px");
    const result = await historyMetrics(page);
    assert.equal(result.sidebarHeight, 700);
    assert.equal(result.searchTop, baseline.searchTop + 36);
    assert.equal(result.treeHeight, baseline.treeHeight - 36);
    assert.deepEqual(result.content, baseline.content);
    assert.equal(result.headerHeight, baseline.headerHeight);
    assert.equal(result.mainMarkers, 0);
    await page.locator("#tree-search").fill("sample");
    await page.getByRole("button", { name: "All", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixture.events), [
      "sample",
      "All",
    ]);
    await page.locator("#tree-container").hover();
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(
      () => document.querySelector("#tree-container").scrollTop > 0,
    );
    assert.deepEqual((await historyMetrics(page)).content, baseline.content);
  }));

test("keeps narrow history open, search, filter and close controls usable", () =>
  withExport(browser, { width: 800 }, async (page, baseline) => {
    assert.equal((await historyMetrics(page)).hamburgerTop, 46);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    assert.equal((await historyMetrics(page)).searchTop, 52);
    assert.deepEqual((await historyMetrics(page)).content, baseline.content);
    await page.locator("#tree-search").fill("narrow");
    await page.getByRole("button", { name: "User", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.locator("#hamburger").isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.fixture.events), [
      "narrow",
      "User",
      "Close",
    ]);
  }));

test("leaves unsupported main, file-panel and history layouts unchanged", async () => {
  for (const options of [{ platform: "Win32" }, { hidden: false }]) {
    await withPage(
      browser,
      { ...options, filePanel: true, fullWidth: true },
      async (page) => {
        assert.equal((await metrics(page)).kind, null);
        const baseline = await page.evaluate(() => window.fixture.fileBaseline);
        const result = await fileMetrics(page);
        assert.equal(result.padding, 0);
        assert.deepEqual(result.content, baseline.content);
      },
    );
  }
  await withExport(
    browser,
    { frame: true },
    async (page, baseline, initial) => {
      assert.equal(initial, "0px");
      assert.deepEqual(await historyMetrics(page), baseline);
    },
  );
});
