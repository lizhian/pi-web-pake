// Run with Node and an installed Playwright. Optional runtime selectors:
// PAKE_PLAYWRIGHT_MODULE / PAKE_BROWSER_EXECUTABLE.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

const script = await fs.readFile("scripts/pi-web-inject.js", "utf8");
const css = await fs.readFile("scripts/pi-web-inject.css", "utf8");
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

async function withExport(options, run) {
  const page = await browser.newPage({
    viewport: { width: options.width || 1200, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    let target = page;
    if (options.frame) {
      await page.evaluate(() => {
        const frame = document.createElement("iframe");
        frame.style.cssText = "width:100%;height:700px;border:0";
        document.body.style.margin = "0";
        document.body.append(frame);
      });
      target = page.frames().find((frame) => frame !== page.mainFrame());
    }
    await target.addStyleTag({
      // Relevant rules from pi-coding-agent's static session export template.
      content: `
        * { margin:0; padding:0; box-sizing:border-box; }
        :root { --sidebar-width:400px; }
        body { font:12px/18px monospace; }
        #app { display:flex; min-height:100vh; }
        #sidebar {
          width:var(--sidebar-width); min-width:var(--sidebar-width); max-width:var(--sidebar-width);
          flex-shrink:0; display:flex; flex-direction:column; position:sticky; top:0;
          height:100vh; border-right:1px solid;
        }
        #sidebar-resizer { width:6px; flex-shrink:0; position:sticky; top:0; height:100vh; }
        .sidebar-header { padding:8px 12px; flex-shrink:0; }
        .sidebar-controls { padding:8px 8px 4px; }
        .sidebar-search { width:100%; padding:4px 8px; border:1px solid; font:11px monospace; }
        .sidebar-filters { display:flex; padding:4px 8px 8px; gap:4px; align-items:center; flex-wrap:wrap; }
        .filter-btn { padding:3px 8px; border:1px solid; font:10px monospace; }
        .sidebar-close { display:none; margin-left:auto; }
        .tree-container { flex:1; overflow:auto; padding:4px 0; }
        .tree-status { flex-shrink:0; padding:4px 12px; }
        #content { flex:1; min-width:0; overflow-y:auto; padding:18px 36px; }
        #hamburger { display:none; position:fixed; top:10px; left:10px; z-index:100; }
        #sidebar-overlay { display:none; position:fixed; inset:0; z-index:98; }
        @media (max-width:900px) {
          #sidebar { position:fixed; left:0; top:0; bottom:0; height:100vh; z-index:99;
            width:min(var(--sidebar-width),100vw); min-width:min(var(--sidebar-width),100vw);
            max-width:min(var(--sidebar-width),100vw); transform:translateX(-100%); }
          #sidebar.open { transform:translateX(0); }
          #sidebar-resizer { display:none; }
          #sidebar-overlay.open { display:block; }
          #hamburger, .sidebar-close { display:block; }
          #content { padding:18px 16px; }
        }
        @media print { #sidebar, #sidebar-resizer { display:none !important; } }
      `,
    });
    await target.evaluate((options) => {
      Object.defineProperty(navigator, "platform", {
        value: options.platform || "MacIntel",
      });
      window.pakeConfig = { hide_title_bar: options.hidden !== false };
      const make = (tag, attrs = {}, children = []) => {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
          if (key === "text") node.textContent = value;
          else node.setAttribute(key, value);
        }
        node.append(...children);
        return node;
      };
      const search = make("input", {
        id: "tree-search",
        class: "sidebar-search",
        placeholder: "Search...",
      });
      const close = make("button", {
        id: "sidebar-close",
        class: "sidebar-close",
        text: "Close",
      });
      const filters = make("div", { class: "sidebar-filters" }, [
        ...["Default", "No-tools", "User", "Labeled", "All"].map((text) =>
          make("button", { class: "filter-btn", text }),
        ),
        close,
      ]);
      const header = make("div", { class: "sidebar-header" }, [
        make("div", { class: "sidebar-controls" }, [search]),
        filters,
      ]);
      const tree = make(
        "div",
        { id: "tree-container", class: "tree-container" },
        Array.from({ length: 160 }, (_, i) =>
          make("div", { text: `Entry ${i}` }),
        ),
      );
      const sidebar = make("aside", { id: "sidebar" }, [
        header,
        tree,
        make("div", { class: "tree-status", text: "160 / 160 entries" }),
      ]);
      const messages = make("div", { id: "messages", text: "Message content" });
      const content = make("main", { id: "content" }, [messages]);
      const hamburger = make("button", {
        id: "hamburger",
        text: "Open sidebar",
      });
      const overlay = make("div", { id: "sidebar-overlay" });
      document.body.append(
        hamburger,
        overlay,
        make("div", { id: "app" }, [
          sidebar,
          make("div", { id: "sidebar-resizer" }),
          content,
        ]),
      );
      const events = [];
      // These listeners check that the adapter leaves the page's controls live.
      search.addEventListener("input", () => events.push(search.value));
      filters.addEventListener("click", (event) =>
        events.push(event.target.textContent),
      );
      hamburger.addEventListener("click", () => {
        sidebar.classList.add("open");
        overlay.classList.add("open");
        hamburger.style.display = "none";
      });
      const closeSidebar = () => {
        sidebar.classList.remove("open");
        overlay.classList.remove("open");
        hamburger.style.display = "";
      };
      close.addEventListener("click", closeSidebar);
      overlay.addEventListener("click", closeSidebar);
      window.fixture = { events };
    }, options);
    if (options.missingMessages)
      await target.locator("#messages").evaluate((node) => node.remove());
    const baseline = await historyMetrics(target);
    await target.addStyleTag({ content: css });
    // Take the measurement in the same task, before a scheduled animation frame.
    const initial = await target.evaluate((source) => {
      (0, eval)(source);
      return getComputedStyle(document.querySelector("#sidebar")).paddingTop;
    }, script);
    await run(target, baseline, initial, page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function historyMetrics(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector("#sidebar");
    const search = document.querySelector("#tree-search");
    const tree = document.querySelector("#tree-container");
    const header = document.querySelector(".sidebar-header");
    const rect = (selector) =>
      document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      sidebarHeight: sidebar.getBoundingClientRect().height,
      padding: parseFloat(getComputedStyle(sidebar).paddingTop),
      searchTop: search.getBoundingClientRect().top,
      headerHeight: header.getBoundingClientRect().height,
      headerLeftPadding: getComputedStyle(header).paddingLeft,
      treeHeight: tree.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      content: rect("#content"),
      hamburgerTop: parseFloat(
        getComputedStyle(document.querySelector("#hamburger")).top,
      ),
      mainMarkers: document.querySelectorAll("[data-pi-web-titlebar]").length,
    };
  });
}

test("reserves 36px synchronously in history without moving the messages pane", () =>
  withExport({}, async (page, baseline, initial) => {
    assert.equal(initial, "36px");
    const result = await historyMetrics(page);
    assert.equal(result.sidebarHeight, 700);
    assert.equal(result.searchTop, baseline.searchTop + 36);
    assert.equal(result.treeHeight, baseline.treeHeight - 36);
    assert.equal(result.scrollHeight, baseline.scrollHeight);
    assert.deepEqual(result.content, baseline.content);
    assert.equal(result.headerHeight, baseline.headerHeight);
    assert.equal(result.headerLeftPadding, baseline.headerLeftPadding);
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

test("moves the narrow-window opener down and keeps open/close controls usable", () =>
  withExport({ width: 800 }, async (page, baseline) => {
    assert.equal((await historyMetrics(page)).hamburgerTop, 46);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    const opened = await historyMetrics(page);
    assert.equal(opened.searchTop, 52);
    assert.deepEqual(opened.content, baseline.content);
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

test("preserves history header layout across sidebar widths and window breakpoints", () =>
  withExport({}, async (page, baseline, initial, windowPage) => {
    for (const width of [240, 600, 400]) {
      await page.evaluate(
        (width) =>
          document.documentElement.style.setProperty(
            "--sidebar-width",
            `${width}px`,
          ),
        width,
      );
      const result = await historyMetrics(page);
      assert.equal(result.sidebarHeight, 700);
      assert.equal(result.searchTop, 52);
      assert.equal(result.content.left, width + 6);
    }
    await windowPage.setViewportSize({ width: 900, height: 700 });
    assert.equal((await historyMetrics(page)).hamburgerTop, 46);
    await windowPage.setViewportSize({ width: 1200, height: 700 });
    assert.deepEqual((await historyMetrics(page)).content, baseline.content);
    await page.evaluate(script);
    assert.equal((await historyMetrics(page)).padding, 36);
  }));

for (const options of [
  { platform: "Win32" },
  { platform: "Linux x86_64" },
  { hidden: false },
  { frame: true },
  { missingMessages: true },
]) {
  test(`leaves unsupported history contexts unchanged: ${JSON.stringify(options)}`, () =>
    withExport(options, async (page, baseline, initial) => {
      assert.equal(initial, "0px");
      assert.deepEqual(await historyMetrics(page), baseline);
    }));
}

test("does not apply the history offsets when printing", () =>
  withExport({ width: 800 }, async (page) => {
    await page.emulateMedia({ media: "print" });
    assert.equal((await historyMetrics(page)).padding, 0);
    assert.equal((await historyMetrics(page)).hamburgerTop, 10);
  }));
