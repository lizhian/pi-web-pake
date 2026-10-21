import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const source = fs.readFileSync(
  "src-tauri/extensions/pake-enhancements/src/window.js",
  "utf8",
);
function renderStyles(height) {
  const styles = new Map();
  const context = {
    window: {
      pakeConfig: { drag_region_height: height },
      __PAKE_INJECT_STYLE__(css, id) {
        styles.set(id, css);
      },
    },
    document: { readyState: "complete" },
  };
  runInNewContext(source, context);
  runInNewContext(source, context);
  return [...styles.values()];
}
describe("enhanced drag region", () => {
  it("keeps the default and applies custom or zero height through the shared style injector", () => {
    expect(renderStyles(undefined)).toEqual([]);
    expect(renderStyles(null)).toEqual([]);
    expect(renderStyles(10)).toEqual([
      "#pake-top-dom { height: 10px !important; }",
    ]);
    expect(renderStyles(0)).toEqual([
      "#pake-top-dom { height: 0px !important; }",
    ]);
  });
});
