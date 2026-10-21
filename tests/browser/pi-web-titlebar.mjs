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

async function withPage(options, run) {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addStyleTag({
      // Relevant Pi Web 0.12.2 rules; its fitting algorithm is retained below.
      content: `
        body { margin: 0; font: 12px Arial; }
        button { font: inherit; }
        #layout { display: flex; height: 700px; }
        #session-sidebar { width: 260px; flex: none; }
        #session-sidebar.sidebar-closed { width: 0; overflow: hidden; }
        .sidebar-header { height: 36px; box-sizing: border-box; border-bottom: 1px solid; }
        .sidebar-header, .sidebar-tabs-list { display: flex; flex: none; align-items: stretch; }
        .sidebar-brand { flex: none; align-self: center; min-width: 6ch; margin: 0 0 0 7px;
          padding: 2px 4px; border: 0; font: bold 15px monospace; white-space: nowrap; }
        .sidebar-header-spacer { flex: 1; min-width: 0; }
        .sidebar-new-button, .sidebar-search-toggle, .sidebar-tab {
          display: flex; flex: none; align-items: center; justify-content: center; gap: 6px;
          padding: 0 12px; border: 0; border-top: 2px solid transparent; white-space: nowrap;
        }
        .sidebar-new-button, .sidebar-tab { border-right: 1px solid; }
        .sidebar-new-button { margin-left: -1px; border-left: 1px solid; }
        .sidebar-header[data-fit="1"] .sidebar-new-button,
        .sidebar-header[data-fit="2"] .sidebar-new-button { width: 36px; padding: 0; }
        .sidebar-header[data-fit="2"] .sidebar-tab { padding: 0 11px; }
        .sidebar-header[data-fit="2"] .sidebar-brand { font-size: 11px; }
        .sidebar-header[data-fit="1"] .sidebar-new-label,
        .sidebar-header[data-fit="2"] .sidebar-new-label,
        .sidebar-header[data-fit="2"] .sidebar-tab-label {
          position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
        }
        #file-panel, #file-panel * { box-sizing: border-box; }
        #file-panel { display:flex; flex-direction:column; flex-shrink:0; overflow:hidden;
          width:420px; --right-panel-width:420px; }
        #file-panel.right-panel-closed { width:0; min-width:0; }
        #file-panel > * { width:var(--right-panel-width); min-width:300px; }
        @media (min-width:641px) and (max-width:959px) {
          #file-panel { position:fixed; top:0; right:0; bottom:0; width:min(560px,100vw - 48px); }
          #file-panel > * { width:100%; min-width:0; }
        }
        @media (min-width:641px) {
          #file-panel.right-panel-open.right-panel-full-width {
            position:fixed; inset:0; width:auto; min-width:0; z-index:250; }
          #file-panel.right-panel-full-width > * { width:100%; min-width:0; }
        }
        @media (max-width:640px) {
          #file-panel { position:fixed; inset:0; width:auto; min-width:0; z-index:250; }
          #file-panel.right-panel-closed { display:none; }
          #file-panel > * { width:100%; min-width:0; }
          .file-panel-expand-button { display:none; }
        }
      `,
    });
    await page.evaluate((options) => {
      window.pakeConfig = { hide_title_bar: options.hidden !== false };
      Object.defineProperty(navigator, "platform", {
        value: options.platform || "MacIntel",
      });
      const make = (tag, attrs = {}, children = []) => {
        const element = document.createElement(tag);
        for (const [name, value] of Object.entries(attrs)) {
          if (name === "text") element.textContent = value;
          else element.setAttribute(name, value);
        }
        element.append(...children);
        return element;
      };
      const icon = () =>
        make("span", { style: "width:16px;height:16px;flex:none" });
      const brand = make("button", { class: "sidebar-brand", text: "Pi Web" });
      const tabs = make(
        "div",
        { class: "sidebar-tabs-list", role: "tablist" },
        [
          make(
            "button",
            { class: "sidebar-tab", id: "session-sidebar-tab-sessions" },
            [
              icon(),
              make("span", {
                class: "sidebar-tab-label",
                text: "Conversations",
              }),
            ],
          ),
          make(
            "button",
            { class: "sidebar-tab", id: "session-sidebar-tab-files" },
            [
              icon(),
              make("span", { class: "sidebar-tab-label", text: "Files" }),
              make("span", { class: "sidebar-tab-count", text: "1" }),
            ],
          ),
        ],
      );
      const header = make("div", { class: "sidebar-header" }, [
        options.tabs ? tabs : brand,
        make("span", { class: "sidebar-header-spacer" }),
        make("button", { class: "sidebar-new-button" }, [
          icon(),
          make("span", { class: "sidebar-new-label", text: "New" }),
        ]),
        make("button", { class: "sidebar-search-toggle" }, [icon()]),
      ]);
      const sidebar = make(
        "div",
        {
          id: "session-sidebar",
          class: "sidebar-container sidebar-open",
        },
        [make("div", { class: "session-sidebar" }, [header])],
      );
      const toolbar = make(
        "div",
        {
          style:
            "display:flex;align-items:center;position:relative;height:36px;border-bottom:1px solid;",
        },
        [
          make("button", {
            "aria-label": "Hide sidebar",
            style: "width:36px;height:36px;flex:none;",
            text: "☰",
          }),
          make("button", {
            text: "Full history",
            style: "height:36px;flex:none;",
          }),
        ],
      );
      const main = make("div", { style: "flex:1;min-width:0;" }, [
        make("div", {}, [toolbar]),
      ]);
      const layout = make("div", { id: "layout" }, [
        sidebar,
        make("div", { "data-resize-handle": "sidebar" }),
        main,
      ]);
      let filePanel;
      let fileHeader;
      if (options.filePanel) {
        const rail = make("div", {
          role: "tablist",
          style:
            "display:flex;align-items:stretch;overflow-x:auto;overflow-y:hidden;height:36px;",
        });
        for (let index = 0; index < 14; index++) {
          const label = index === 1 ? "Terminal" : `file-${index}.ts`;
          const close = make("button", {
            "aria-label": `Close ${label}`,
            text: "×",
          });
          const tab = make(
            "div",
            {
              role: "tab",
              "aria-label": label,
              "aria-selected": String(index === 0),
              style:
                "display:flex;align-items:center;gap:6px;padding:0 6px 0 12px;min-width:80px;max-width:180px;flex-shrink:0;white-space:nowrap;",
            },
            [make("span", { text: label }), close],
          );
          tab.addEventListener("click", () => {
            for (const sibling of rail.children)
              sibling.setAttribute("aria-selected", String(sibling === tab));
          });
          close.addEventListener("click", (event) => {
            event.stopPropagation();
            tab.remove();
          });
          rail.append(tab);
        }
        const expand = make("button", {
          class: "file-panel-expand-button",
          "aria-controls": "file-panel",
          "aria-label": "Expand file panel",
          "aria-pressed": String(!!options.fullWidth),
          style: "width:36px;height:36px;flex-shrink:0;",
          text: "↗",
        });
        const close = make("button", {
          "aria-label": "Hide file panel",
          style: "width:36px;height:36px;flex-shrink:0;",
          text: "◧",
        });
        fileHeader = make(
          "div",
          {
            style:
              "display:flex;align-items:center;flex-shrink:0;height:36px;border-bottom:1px solid;",
          },
          [
            make("div", { style: "flex:1;overflow:hidden;" }, [rail]),
            expand,
            close,
          ],
        );
        filePanel = make(
          "div",
          {
            id: "file-panel",
            class: `right-panel-container right-panel-open${options.fullWidth ? " right-panel-full-width" : ""}`,
          },
          [
            fileHeader,
            make("div", {
              id: "file-panel-content",
              text: "File toolbar and editor",
            }),
          ],
        );
        expand.addEventListener("click", () => {
          expand.setAttribute(
            "aria-pressed",
            String(filePanel.classList.toggle("right-panel-full-width")),
          );
        });
        close.addEventListener("click", () => {
          filePanel.classList.remove("right-panel-open");
          filePanel.classList.add("right-panel-closed");
        });
        layout.append(filePanel);
      }
      const fit = () => {
        for (const state of ["0", "1", "2"]) {
          header.dataset.fit = state;
          if (header.scrollWidth <= header.clientWidth) return;
        }
      };
      document.body.append(layout);
      fit();
      const resize = new ResizeObserver(fit);
      resize.observe(header);
      window.fixture = {
        sidebar,
        header,
        toolbar,
        main,
        fit,
        tabs,
        brand,
        resize,
        filePanel,
        fileHeader,
        fileBaseline: fileHeader && {
          header: fileHeader.getBoundingClientRect().toJSON(),
          content: filePanel.lastElementChild.getBoundingClientRect().toJSON(),
          actionsLeft: fileHeader
            .querySelector(".file-panel-expand-button")
            .getBoundingClientRect().left,
          railWidth: fileHeader.querySelector('[role="tablist"]').clientWidth,
        },
      };
    }, options);
    await page.addStyleTag({ content: css });
    await page.evaluate((source) => {
      (0, eval)(source);
      const header = document.querySelector("[data-pi-web-titlebar]");
      window.fixture.initialGutter = header
        ? parseFloat(getComputedStyle(header).paddingLeft)
        : 0;
      window.fixture.initialFileGutter = window.fixture.fileHeader
        ? getComputedStyle(window.fixture.fileHeader).paddingLeft
        : null;
    }, script);
    await settle(page);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function settle(page) {
  // Allow both the upstream fitting observer and adapter to settle, then assert
  // stability. A single animation frame cannot detect observer feedback loops.
  await page.waitForTimeout(100);
  const first = await metrics(page);
  await page.waitForTimeout(100);
  assert.deepEqual(await metrics(page), first);
}

async function metrics(page) {
  return page.evaluate(() => {
    const { header, toolbar, brand, sidebar } = window.fixture;
    const active = document.querySelector("[data-pi-web-titlebar]");
    return {
      kind: active?.getAttribute("data-pi-web-titlebar") || null,
      gutter: active ? parseFloat(getComputedStyle(active).paddingLeft) : 0,
      height: active?.getBoundingClientRect().height,
      sidebarWidth: sidebar.getBoundingClientRect().width,
      brand: brand.isConnected && getComputedStyle(brand).display !== "none",
      fit: header.dataset.fit,
      overflow: header.scrollWidth > header.clientWidth + 1,
      mainPadding: parseFloat(getComputedStyle(toolbar).paddingLeft),
      firstButton: active?.querySelector("button")?.getBoundingClientRect()
        .left,
    };
  });
}

test("reserves 80px once and preserves the wide brand and buttons", () =>
  withPage({}, async (page) => {
    assert.equal(await page.evaluate(() => window.fixture.initialGutter), 80);
    assert.deepEqual(await metrics(page), {
      kind: "sidebar",
      gutter: 80,
      height: 36,
      sidebarWidth: 260,
      brand: true,
      fit: "0",
      overflow: false,
      mainPadding: 0,
      firstButton: 87,
    });
    await page.locator(".sidebar-new-button").evaluate((button) => {
      button.addEventListener("click", () => {
        window.clicked = true;
      });
    });
    await page.locator(".sidebar-new-button").click();
    assert.equal(await page.evaluate(() => window.clicked), true);
  }));

test("hides the brand at the existing compact state and restores it on resize", () =>
  withPage({}, async (page) => {
    for (const width of [220, 180, 300, 200, 260]) {
      await page.evaluate((width) => {
        window.fixture.sidebar.style.width = `${width}px`;
      }, width);
      await settle(page);
      const result = await metrics(page);
      assert.equal(result.gutter, 80);
      assert.equal(result.overflow, false);
      assert.equal(result.brand, width >= 260);
    }
  }));

test("keeps compact tabs usable at 180px and restores the full gutter", () =>
  withPage({ tabs: true }, async (page) => {
    for (const width of [400, 260, 180, 190, 230, 400]) {
      await page.evaluate((width) => {
        window.fixture.sidebar.style.width = `${width}px`;
      }, width);
      await settle(page);
      const result = await metrics(page);
      assert.equal(result.overflow, false);
      assert.ok(result.gutter >= 0 && result.gutter <= 80);
      assert.equal(await page.locator(".sidebar-tab").count(), 2);
      if (width === 180) assert.ok(result.gutter < 80);
      if (width === 400) assert.equal(result.gutter, 80);
    }
  }));

test("moves the gutter to the main toolbar on collapse without duplication", () =>
  withPage({}, async (page) => {
    for (const expanded of [false, true, false, true]) {
      await page.evaluate((expanded) => {
        window.fixture.sidebar.className = `sidebar-container sidebar-${expanded ? "open" : "closed"}`;
      }, expanded);
      await settle(page);
      const result = await metrics(page);
      assert.equal(result.kind, expanded ? "sidebar" : "main");
      assert.equal(result.mainPadding, expanded ? 0 : 80);
      assert.equal(await page.locator("[data-pi-web-titlebar]").count(), 1);
      if (!expanded) assert.equal(result.firstButton, 80);
    }
  }));

test("rebinds after React replaces the sidebar header", () =>
  withPage({}, async (page) => {
    await page.evaluate(() => {
      const old = window.fixture.header;
      const replacement = old.cloneNode(true);
      replacement.removeAttribute("data-pi-web-titlebar");
      replacement.style.removeProperty("--pi-web-titlebar-gutter");
      old.replaceWith(replacement);
      window.fixture.header = replacement;
    });
    await settle(page);
    assert.equal((await metrics(page)).kind, "sidebar");
    assert.equal(await page.locator("[data-pi-web-titlebar]").count(), 1);
  }));

test("ignores exported history headers and unknown main toolbar structures", () =>
  withPage({}, async (page) => {
    await page.evaluate(() => {
      window.fixture.main.replaceChildren();
    });
    await settle(page);
    assert.equal((await metrics(page)).kind, null);
    await page.evaluate(() => {
      window.fixture.sidebar.id = "export-sidebar";
      const exportHeader = document.createElement("div");
      exportHeader.className = "sidebar-header";
      document.body.append(exportHeader);
    });
    await settle(page);
    assert.equal(await page.locator("[data-pi-web-titlebar]").count(), 0);
  }));

for (const options of [
  { platform: "Win32" },
  { platform: "Linux x86_64" },
  { hidden: false },
]) {
  test(`leaves unsupported contexts unchanged: ${JSON.stringify(options)}`, () =>
    withPage(options, async (page) => {
      const result = await metrics(page);
      assert.equal(result.kind, null);
      assert.equal(result.gutter, 0);
      assert.equal(result.brand, true);
    }));
}

test("does not install twice or react to unrelated chat updates", () =>
  withPage({}, async (page) => {
    await page.evaluate(script);
    const before = await metrics(page);
    await page.evaluate(() => {
      const chat = document.createElement("div");
      window.fixture.main.append(chat);
      for (let i = 0; i < 200; i++) chat.append(document.createElement("span"));
    });
    await settle(page);
    assert.deepEqual(await metrics(page), before);
  }));

async function fileMetrics(page) {
  return page.evaluate(() => {
    const { filePanel, fileHeader } = window.fixture;
    const rail = fileHeader.querySelector('[role="tablist"]');
    return {
      padding: parseFloat(getComputedStyle(fileHeader).paddingLeft),
      header: fileHeader.getBoundingClientRect().toJSON(),
      content: filePanel.lastElementChild.getBoundingClientRect().toJSON(),
      actionsLeft: fileHeader
        .querySelector(".file-panel-expand-button")
        .getBoundingClientRect().left,
      closeRight: fileHeader.lastElementChild.getBoundingClientRect().right,
      railLeft: rail.getBoundingClientRect().left,
      railWidth: rail.clientWidth,
    };
  });
}

test("reserves 80px on the first full-width file-panel layout without moving content or actions", () =>
  withPage({ filePanel: true, fullWidth: true }, async (page) => {
    assert.equal(
      await page.evaluate(() => window.fixture.initialFileGutter),
      "80px",
    );
    const before = await page.evaluate(() => window.fixture.fileBaseline);
    const result = await fileMetrics(page);
    assert.equal(result.padding, 80);
    assert.equal(result.header.height, 36);
    assert.equal(result.railLeft, 80);
    assert.equal(result.railWidth, before.railWidth - 80);
    assert.deepEqual(result.header, before.header);
    assert.deepEqual(result.content, before.content);
    assert.equal(result.actionsLeft, before.actionsLeft);
  }));

test("removes file-panel padding on restore or close and never accumulates it on reopen", () =>
  withPage({ filePanel: true }, async (page) => {
    for (let iteration = 0; iteration < 3; iteration++) {
      assert.equal((await fileMetrics(page)).padding, 0);
      await page
        .getByRole("button", { name: "Expand file panel", exact: true })
        .click();
      assert.equal((await fileMetrics(page)).padding, 80);
      await page
        .getByRole("button", { name: "Hide file panel", exact: true })
        .click();
      assert.equal((await fileMetrics(page)).padding, 0);
      await page.evaluate(() => {
        const panel = window.fixture.filePanel;
        panel.classList.replace("right-panel-closed", "right-panel-open");
      });
      assert.equal((await fileMetrics(page)).padding, 80);
      await page
        .getByRole("button", { name: "Expand file panel", exact: true })
        .click();
      assert.equal((await fileMetrics(page)).padding, 0);
    }
  }));

test("keeps the file gutter fixed while scrolling, selecting terminal tabs and closing files", () =>
  withPage({ filePanel: true, fullWidth: true }, async (page) => {
    const before = await fileMetrics(page);
    const rail = page.locator('#file-panel [role="tablist"]');
    await rail.hover();
    await page.mouse.wheel(400, 0);
    await page.waitForFunction(
      () =>
        document.querySelector('#file-panel [role="tablist"]').scrollLeft > 0,
    );
    assert.deepEqual(await fileMetrics(page), before);
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    assert.equal(
      await page
        .getByRole("tab", { name: "Terminal", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page
      .getByRole("button", { name: "Close file-0.ts", exact: true })
      .click();
    assert.equal(
      await page.getByRole("tab", { name: "file-0.ts", exact: true }).count(),
      0,
    );
    assert.deepEqual(await fileMetrics(page), before);
  }));

test("reserves space for automatic full width at 640px but leaves floating and split panels alone", () =>
  withPage({ filePanel: true }, async (page) => {
    for (const width of [1200, 960, 959, 800, 641, 640, 600, 640, 641, 1000]) {
      await page.setViewportSize({ width, height: 700 });
      const result = await fileMetrics(page);
      assert.equal(result.padding, width <= 640 ? 80 : 0);
      assert.equal(result.header.height, 36);
      assert.equal(result.content.left, result.header.left);
      assert.equal(result.content.top, result.header.bottom);
      assert.equal(result.closeRight, width);
    }
  }));

for (const options of [
  { platform: "Win32" },
  { platform: "Linux x86_64" },
  { hidden: false },
]) {
  test(`leaves file panels unchanged outside the macOS overlay: ${JSON.stringify(options)}`, () =>
    withPage({ ...options, filePanel: true, fullWidth: true }, async (page) => {
      const result = await fileMetrics(page);
      const before = await page.evaluate(() => window.fixture.fileBaseline);
      assert.equal(result.padding, 0);
      assert.deepEqual(result.header, before.header);
      assert.deepEqual(result.content, before.content);
    }));
}
