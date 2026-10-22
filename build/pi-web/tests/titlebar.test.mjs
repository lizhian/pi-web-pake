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
        window.fixture.sidebar.style.setProperty(
          "--sidebar-width",
          `${width}px`,
        );
      }, width);
      await settle(page);
      const result = await metrics(page);
      assert.equal(result.overflow, false);
      assert.equal(result.brand, width === 260);
    }
    await page.evaluate(() =>
      window.fixture.sidebar.style.removeProperty("--sidebar-width"),
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
    assert.equal(await page.locator("[data-pi-web-titlebar]").count(), 2);
    await page.locator(".sidebar-new-button").evaluate((button) => {
      button.addEventListener("click", () => {
        window.clicked = true;
      });
    });
    await page.locator(".sidebar-new-button").click();
    assert.equal(await page.evaluate(() => window.clicked), true);
  }));

test("keeps titlebar controls clear of traffic lights throughout sidebar transitions", async () => {
  for (const tabs of [false, true]) {
    await withPage(browser, { tabs, closed: true }, async (page) => {
      assert.equal(
        await page.evaluate(() => window.fixture.initialMainButtonLeft),
        80,
      );
      await page.evaluate((tabs) => {
        window.fixture.sidebar.style.setProperty(
          "--sidebar-width",
          tabs ? "360px" : "180px",
        );
        window.fixture.sidebar.className = "sidebar-container sidebar-open";
      }, tabs);
      await settle(page);
      const samples = await page.evaluate(async () => {
        const { sidebar, header, toolbar, brand } = window.fixture;
        const samples = [];
        for (const expanded of [false, true, false, true]) {
          sidebar.classList.toggle("sidebar-open", expanded);
          sidebar.classList.toggle("sidebar-closed", !expanded);
          const start = performance.now();
          await new Promise((resolve) => {
            function sample() {
              const visibleWidth = sidebar.getBoundingClientRect().width;
              samples.push({
                mainButtonLeft:
                  toolbar.firstElementChild.getBoundingClientRect().left,
                brandVisible:
                  brand.isConnected &&
                  visibleWidth > 0 &&
                  getComputedStyle(brand).display !== "none",
                sidebarPadding: parseFloat(
                  getComputedStyle(header).paddingLeft,
                ),
              });
              if (performance.now() - start < 250)
                requestAnimationFrame(sample);
              else resolve();
            }
            requestAnimationFrame(sample);
          });
        }
        return samples;
      });
      assert.ok(samples.length > 8);
      assert.ok(
        samples.every((sample) => sample.mainButtonLeft >= 79),
        JSON.stringify(samples.filter((sample) => sample.mainButtonLeft < 79)),
      );
      assert.ok(samples.every((sample) => sample.sidebarPadding === 80));
      assert.ok(samples.every((sample) => !sample.brandVisible));
      if (tabs) {
        assert.equal(
          await page
            .locator("#session-sidebar-tab-sessions")
            .evaluate((tab) => getComputedStyle(tab).borderLeftWidth),
          "1px",
        );
      }
      await page.evaluate(() => {
        window.fixture.sidebar.className = "sidebar-container sidebar-closed";
      });
      await settle(page);
      assert.equal(
        await page
          .locator('[aria-label="Hide sidebar"]')
          .evaluate((button) => getComputedStyle(button).borderLeftWidth),
        "1px",
      );
    });
  }
});

test("reserves file-panel space in full-width and narrow layouts and restores the split layout", () =>
  withPage(browser, { filePanel: true, fullWidth: true }, async (page) => {
    const baseline = await page.evaluate(() => window.fixture.fileBaseline);
    const full = await fileMetrics(page);
    assert.equal(full.padding, 80);
    assert.equal(full.railLeft, 80);
    assert.deepEqual(full.header, baseline.header);
    assert.deepEqual(full.content, baseline.content);
    assert.equal(full.actionsLeft, baseline.actionsLeft);
    assert.equal(full.railTop, full.header.top);
    assert.equal(full.railBottom, full.header.bottom - 1);
    assert.deepEqual(full.tabLeftBorders, ["1px", "0px"]);
    assert.deepEqual(full.containerLeftBorders, ["0px", "0px", "0px"]);
    await page
      .getByRole("button", { name: "Expand file panel", exact: true })
      .click();
    const split = await fileMetrics(page);
    assert.equal(split.padding, 0);
    assert.deepEqual(split.tabLeftBorders, ["0px", "0px"]);
    await page.setViewportSize({ width: 600, height: 700 });
    const narrow = await fileMetrics(page);
    assert.equal(narrow.padding, 80);
    assert.equal(narrow.content.top, narrow.header.bottom);
    assert.equal(narrow.closeRight, 600);
    assert.equal(narrow.railTop, narrow.header.top);
    assert.equal(narrow.railBottom, narrow.header.bottom - 1);
    assert.deepEqual(narrow.tabLeftBorders, ["1px", "0px"]);
    const tabs = page.locator('#file-panel [role="tab"]');
    await tabs.first().getByRole("button").click();
    assert.deepEqual((await fileMetrics(page)).tabLeftBorders, ["1px"]);
    await tabs.first().getByRole("button").click();
    const empty = await fileMetrics(page);
    assert.deepEqual(empty.tabLeftBorders, []);
    assert.deepEqual(empty.containerLeftBorders, ["0px", "0px", "0px"]);
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
    assert.equal(result.searchTop, 36);
    assert.equal(result.treeHeight, baseline.treeHeight - 20);
    assert.deepEqual(result.content, baseline.content);
    assert.equal(result.headerHeight, baseline.headerHeight - 16);
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
    assert.equal((await historyMetrics(page)).searchTop, 36);
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
