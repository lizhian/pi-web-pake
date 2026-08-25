import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function renderStyles(dragRegionHeight) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src-tauri/src/inject/managed-window.js"),
    "utf8",
  );
  const listeners = {};
  const children = [];
  const context = {
    window: {
      pakeConfig: {
        ...(dragRegionHeight === undefined
          ? {}
          : { drag_region_height: dragRegionHeight }),
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
    },
    document: {
      createElement: () => ({ textContent: "" }),
      head: {
        appendChild(child) {
          children.push(child);
        },
      },
    },
  };
  runInNewContext(source, context);
  listeners.DOMContentLoaded();
  return children.map((child) => child.textContent).join("\n");
}

describe("immersive drag region height", () => {
  it("does not override the upstream default when unset", () => {
    expect(renderStyles(undefined)).toBe("");
  });

  it("uses custom and zero-height values", () => {
    expect(renderStyles(10)).toContain("height: 10px");
    expect(renderStyles(0)).toContain("height: 0px");
  });
});
