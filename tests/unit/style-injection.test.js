import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "src-tauri/src/inject/styles.js"),
  "utf-8",
);

function loadStyleHelper({
  supportsAdoptedStyleSheets,
  blocksStyleElements = true,
}) {
  const appendedStyles = [];
  const document = {
    head: {
      appendChild(style) {
        appendedStyles.push(style);
        style.sheet = blocksStyleElements ? null : {};
        return style;
      },
    },
    createElement(tagName) {
      return {
        tagName,
        id: "",
        textContent: "",
        remove() {
          appendedStyles.splice(appendedStyles.indexOf(this), 1);
        },
      };
    },
    getElementById() {
      return null;
    },
  };

  if (supportsAdoptedStyleSheets) {
    document.adoptedStyleSheets = [];
  }

  const context = {
    document,
    window: {
      CSSStyleSheet: class CSSStyleSheet {
        replaceSync(css) {
          this.cssText = css;
        }
      },
    },
  };

  runInNewContext(source, context);
  return { appendedStyles, context };
}

describe("Pake style injection", () => {
  it("preserves DOM stylesheet order when inline styles are allowed", () => {
    const { appendedStyles, context } = loadStyleHelper({
      supportsAdoptedStyleSheets: true,
      blocksStyleElements: false,
    });
    context.window.__PAKE_INJECT_STYLE__("body { color: red; }");
    context.window.__PAKE_INJECT_STYLE__(
      '@import "theme.css"; body { color: blue; }',
    );
    expect(context.document.adoptedStyleSheets).toHaveLength(0);
    expect(appendedStyles.map((style) => style.textContent)).toEqual([
      "body { color: red; }",
      '@import "theme.css"; body { color: blue; }',
    ]);
  });

  it("uses adopted style sheets when the page blocks style elements", () => {
    const { appendedStyles, context } = loadStyleHelper({
      supportsAdoptedStyleSheets: true,
    });
    const injectStyle = context.window.__PAKE_INJECT_STYLE__;

    const sheet = injectStyle("body { color: red; }", "pake-test-style");

    expect(sheet.cssText).toBe("body { color: red; }");
    expect(context.document.adoptedStyleSheets).toEqual([sheet]);
    expect(appendedStyles).toHaveLength(0);
    expect(injectStyle("body { color: blue; }", "pake-test-style")).toBe(sheet);
  });

  it("recreates a cached sheet after the page removes it", () => {
    const { context } = loadStyleHelper({
      supportsAdoptedStyleSheets: true,
    });
    const injectStyle = context.window.__PAKE_INJECT_STYLE__;

    const firstSheet = injectStyle("body { color: red; }", "pake-test-style");
    context.document.adoptedStyleSheets = [];
    const secondSheet = injectStyle("body { color: blue; }", "pake-test-style");

    expect(secondSheet).not.toBe(firstSheet);
    expect(secondSheet.cssText).toBe("body { color: blue; }");
    expect(context.document.adoptedStyleSheets).toEqual([secondSheet]);
  });

  it("keeps CSS imports on the style-element path", () => {
    const { appendedStyles, context } = loadStyleHelper({
      supportsAdoptedStyleSheets: true,
    });

    context.window.__PAKE_INJECT_STYLE__(
      '@import url("theme.css");\nbody { color: red; }',
      "pake-test-style",
    );

    expect(context.document.adoptedStyleSheets).toHaveLength(0);
    expect(appendedStyles).toHaveLength(1);
    expect(appendedStyles[0].textContent).toContain("@import");
  });

  it.each([
    '/* theme */@import "theme.css";',
    '@IMPORT "theme.css";',
    '@charset "UTF-8";@import "theme.css";',
    '@\\69mport "theme.css";',
  ])("does not silently discard imports under CSP: %s", (css) => {
    const { appendedStyles, context } = loadStyleHelper({
      supportsAdoptedStyleSheets: true,
    });
    context.window.__PAKE_INJECT_STYLE__(css);
    expect(context.document.adoptedStyleSheets).toHaveLength(0);
    expect(appendedStyles[0].textContent).toBe(css);
  });

  it.each([
    '/* @import */ body::before { content: "@import"; }',
    ".\\@import { color: red; }",
    "@import-theme; body { color: red; }",
  ])("does not mistake other CSS tokens for import rules: %s", (css) => {
    const { context } = loadStyleHelper({ supportsAdoptedStyleSheets: true });
    context.window.__PAKE_INJECT_STYLE__(css);
    expect(context.document.adoptedStyleSheets).toHaveLength(1);
  });

  it("falls back to a style element when adopted style sheets are unavailable", () => {
    const { appendedStyles, context } = loadStyleHelper({
      supportsAdoptedStyleSheets: false,
    });

    context.window.__PAKE_INJECT_STYLE__(
      "body { color: red; }",
      "pake-test-style",
    );

    expect(appendedStyles).toHaveLength(1);
    expect(appendedStyles[0]).toMatchObject({
      tagName: "style",
      id: "pake-test-style",
      textContent: "body { color: red; }",
    });
  });
});
