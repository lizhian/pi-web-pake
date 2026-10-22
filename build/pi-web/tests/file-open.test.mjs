import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { script, css, launchBrowser } from "./fixtures/browser.mjs";

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => browser?.close());

async function withTree(native, run) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addStyleTag({ content: css });
    await page.evaluate((native) => {
      document.documentElement.lang = "zh-CN";
      window.calls = [];
      window.toasts = [];
      window.rowClicks = 0;
      window.pakeToast = (message) => window.toasts.push(message);
      window.pakeConfig = {};
      if (native)
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              window.calls.push({ command, args });
              if (window.fail) return Promise.reject("<img src=x> open failed");
              return new Promise((resolve) => {
                window.finishOpen = resolve;
              });
            },
          },
        };
      const make = (tag, attributes = {}) => {
        const element = document.createElement(tag);
        for (const [name, value] of Object.entries(attributes))
          element.setAttribute(name, value);
        return element;
      };
      const row = (name, directory) => {
        const item = make("div", {
          style:
            "position:relative;display:flex;align-items:center;height:24px;width:400px;--border:#444;--bg-panel:#222;--text-muted:#aaa;--text:#fff;--accent:#acf",
        });
        item.dataset.name = name;
        const icon = make("span");
        icon.append(make("span", { class: "fixture-file-icon" }));
        const label = make("span", {
          title: `/tmp/中文 project/${name}`,
          style: "flex:1;overflow:hidden;white-space:nowrap",
        });
        label.textContent = name;
        item.append(icon, label);
        item.addEventListener("click", () => window.rowClicks++);
        item.addEventListener("mouseenter", () => {
          if (item.querySelector(".mention")) return;
          const mention = make("button", {
            class: "mention",
            style: `position:absolute;right:${directory ? 4 : 28}px;top:50%;transform:translateY(-50%);height:20px;width:60px`,
          });
          mention.textContent = "@ 提及";
          item.append(mention);
          if (!directory)
            item.append(
              make("a", {
                download: "",
                href: "/download",
                style:
                  "position:absolute;right:4px;top:50%;transform:translateY(-50%);height:20px;width:22px",
              }),
            );
        });
        item.addEventListener("mouseleave", () =>
          item
            .querySelectorAll(".mention, a[download]")
            .forEach((action) => action.remove()),
        );
        return item;
      };
      window.mountTree = () => {
        document.querySelector("#session-sidebar")?.remove();
        const sidebar = make("div", { id: "session-sidebar" });
        const tree = make("div", { class: "sidebar-files-scroll" });
        tree.append(row(".agents", true), row("文档 name.txt", false));
        sidebar.append(tree);
        document.body.append(sidebar);
      };
      window.mountTree();
    }, native);
    await page.evaluate(script);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

test("opens original directory/file paths from the rightmost action without activating rows", () =>
  withTree(true, async (page) => {
    const rows = page.locator("[data-pi-web-file-row]");
    await page.waitForFunction(
      () => document.querySelectorAll("button[data-pi-web-open]").length === 2,
    );
    for (let index = 0; index < 2; index++) {
      const row = rows.nth(index);
      const open = row.locator("button[data-pi-web-open]");
      await row.hover();
      const geometry = await row.evaluate((item) => {
        const open = item
          .querySelector("button[data-pi-web-open]")
          .getBoundingClientRect();
        const actions = [...item.querySelectorAll(".mention, a[download]")];
        return {
          left: open.left,
          previousRight: Math.max(
            ...actions.map((action) => action.getBoundingClientRect().right),
          ),
        };
      });
      assert.ok(geometry.left >= geometry.previousRight + 1);
      await open.click();
      assert.equal(await open.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.rowClicks), 0);
      await page.evaluate(() => window.finishOpen());
      await page.waitForFunction(
        () => !document.querySelector("button[data-pi-web-open]:disabled"),
      );
    }
    assert.deepEqual(await page.evaluate(() => window.calls), [
      {
        command: "plugin:opener|open_path",
        args: { path: "/tmp/中文 project/.agents" },
      },
      {
        command: "plugin:opener|open_path",
        args: { path: "/tmp/中文 project/文档 name.txt" },
      },
    ]);
    await page.mouse.move(700, 400);
    const open = rows.first().locator("button[data-pi-web-open]");
    assert.equal(
      await open.evaluate((button) => getComputedStyle(button).opacity),
      "0",
    );
    await open.focus();
    assert.equal(
      await open.evaluate((button) => getComputedStyle(button).opacity),
      "1",
    );
    await open.press("Enter");
    assert.equal(await page.evaluate(() => window.calls.length), 3);
    await page.evaluate(() => window.finishOpen());
  }));

test("respects native context and recovers across remounts, reinjection, path updates and failures", async () => {
  await withTree(true, async (page) => {
    await page.evaluate(() => window.mountTree());
    await page.waitForFunction(
      () => document.querySelectorAll("button[data-pi-web-open]").length === 2,
    );
    await page.evaluate(script);
    assert.equal(await page.locator("button[data-pi-web-open]").count(), 2);
    await page.locator('[data-name="文档 name.txt"]').evaluate((row) => {
      const label = row.querySelector("span[title]");
      const replacement = label.cloneNode(true);
      replacement.setAttribute(
        "title",
        "C:\\中文 project\\.hidden\\name.txt\nHidden file",
      );
      replacement.setAttribute("data-hidden-reason", "hidden");
      label.replaceWith(replacement);
      window.fail = true;
    });
    const open = page.locator(
      '[data-name="文档 name.txt"] button[data-pi-web-open]',
    );
    await open.focus();
    await open.press("Space");
    await page.waitForFunction(() => window.toasts.length === 1);
    assert.equal(await open.isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => window.calls[0].args), {
      path: "C:\\中文 project\\.hidden\\name.txt",
    });
    assert.ok(!(await page.evaluate(() => window.toasts[0])).includes("<img"));
    await page.evaluate(() => {
      window.fail = false;
    });
    await open.click();
    assert.equal(await open.isDisabled(), true);
    await page.evaluate(() => window.finishOpen());
  });
  await withTree(false, async (page) => {
    assert.equal(await page.locator("button[data-pi-web-open]").count(), 0);
  });
});
