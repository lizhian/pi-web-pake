import assert from "node:assert/strict";
import fs from "node:fs/promises";

export const script = await fs.readFile(
  new URL("../../scripts/pi-web-inject.js", import.meta.url),
  "utf8",
);
const css = await fs.readFile(
  new URL("../../scripts/pi-web-inject.css", import.meta.url),
  "utf8",
);

export async function withPage(browser, options, run) {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addStyleTag({
      // Relevant Pi Web 0.12.2 rules; its fitting algorithm is retained below.
      content: `
        :root { --border:#444; --bg-panel:#222; --bg:#1a1a1a; }
        body { margin: 0; font: 12px Arial; }
        button { font: inherit; }
        #layout { display: flex; height: 700px; }
        #session-sidebar { width:var(--sidebar-width,260px); min-width:var(--sidebar-width,260px);
          flex:none; overflow:hidden; transition:width .2s,min-width .2s; }
        #session-sidebar.sidebar-closed { width:0; min-width:0; }
        #session-sidebar > * { width:var(--sidebar-width,260px); min-width:var(--sidebar-width,260px); }
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
          class: `sidebar-container sidebar-${options.closed ? "closed" : "open"}`,
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
            "display:flex;align-items:stretch;overflow-x:auto;overflow-y:hidden;height:36px;background:var(--bg-panel);",
        });
        for (let index = 0; index < 2; index++) {
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
              style: `display:flex;align-items:center;gap:6px;padding:0 6px 0 12px;min-width:80px;max-width:180px;flex-shrink:0;white-space:nowrap;border-right:1px solid var(--border);background:var(--${index === 0 ? "bg" : "bg-panel"});`,
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
              "display:flex;align-items:center;flex-shrink:0;height:36px;border-bottom:1px solid var(--border);background:var(--bg-panel);",
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
      window.fixture.initialMainButtonLeft =
        window.fixture.toolbar.firstElementChild.getBoundingClientRect().left;
    }, script);
    await settle(page);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

export async function settle(page) {
  // Allow both the upstream fitting observer and adapter to settle, then assert
  // stability. A single animation frame cannot detect observer feedback loops.
  await page.waitForTimeout(250);
  const first = await metrics(page);
  await page.waitForTimeout(100);
  assert.deepEqual(await metrics(page), first);
}

export async function metrics(page) {
  return page.evaluate(() => {
    const { header, toolbar, brand, sidebar } = window.fixture;
    const active = sidebar.classList.contains("sidebar-open")
      ? header
      : toolbar;
    return {
      kind: active?.getAttribute("data-pi-web-titlebar") || null,
      gutter: parseFloat(getComputedStyle(active).paddingLeft),
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

export async function fileMetrics(page) {
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
      railTop: rail.getBoundingClientRect().top,
      railBottom: rail.getBoundingClientRect().bottom,
      railWidth: rail.clientWidth,
      tabLeftBorders: Array.from(
        rail.children,
        (tab) => getComputedStyle(tab).borderLeftWidth,
      ),
      containerLeftBorders: [fileHeader, rail.parentElement, rail].map(
        (element) => getComputedStyle(element).borderLeftWidth,
      ),
    };
  });
}

export async function withExport(browser, options, run) {
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

export async function historyMetrics(page) {
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
