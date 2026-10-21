import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = fs.readFileSync(
  new URL("../../scripts/pi-web-inject.js", import.meta.url),
  "utf8",
);
const origin = "http://127.0.0.1:30141";
const home = origin + "/app/index?session=test";

function load({
  platform = "MacIntel",
  enabled = true,
  blocked = false,
  isolationError = false,
  frame = false,
  forceInternal = false,
  popupUrl = "about:blank",
  popupDocumentError = false,
  hasBody = true,
} = {}) {
  let opener = {};
  const popupDocument = {
    URL: popupUrl,
    documentElement: { style: {} },
    body: hasBody ? { style: {} } : null,
  };
  const popup = {
    get document() {
      if (popupDocumentError) throw new Error("document access denied");
      return popupDocument;
    },
    get opener() {
      return opener;
    },
    set opener(value) {
      if (isolationError) throw new Error("isolation failed");
      opener = value;
    },
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  const nativeOpen = vi.fn(() => (blocked ? null : popup));
  const listeners = [];
  const document = {
    baseURI: home,
    createElement: vi.fn(),
    addEventListener: (type, handler, capture) =>
      listeners.push({ type, handler, capture }),
  };
  const log = { warn: vi.fn() };
  const window = {
    location: { href: home, origin },
    pakeConfig: {
      new_window: enabled,
      force_internal_navigation: forceInternal,
    },
    open: nativeOpen,
    addEventListener: (type, handler, capture) =>
      listeners.push({ type, handler, capture }),
    isAuthPopup: vi.fn((url) => url.includes("/auth/")),
    isAuthLink: vi.fn((url) => url.includes("/auth/")),
  };
  window.top = frame ? {} : window;
  runInNewContext(source, {
    URL,
    console: log,
    navigator: { platform },
    window,
    document,
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
  });
  const click = (
    href = "/project",
    overrides = {},
    attributes = {},
    pageHandler,
  ) => {
    const attrs = { href, target: "_blank", rel: "", ...attributes };
    const anchor = {
      href: new URL(href, document.baseURI).href,
      target: attrs.target,
      rel: attrs.rel,
      getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
      hasAttribute: (name) => Object.hasOwn(attrs, name),
    };
    const event = {
      target: { closest: () => anchor },
      button: 0,
      defaultPrevented: false,
      preventDefault: vi.fn(function () {
        this.defaultPrevented = true;
      }),
      ...overrides,
    };
    for (const listener of listeners.filter(
      (item) => item.type === "click" && item.capture,
    ))
      listener.handler(event);
    pageHandler?.(event, anchor);
    for (const listener of listeners.filter(
      (item) => item.type === "click" && !item.capture,
    ))
      listener.handler(event);
    return event;
  };
  return {
    window,
    document,
    popup,
    popupDocument,
    nativeOpen,
    listeners,
    log,
    click,
  };
}

describe("same-origin popup injection", () => {
  it("paints the initial document black while the direct navigation is pending", () => {
    const { window, popupDocument } = load();
    expect(window.open("/project", "_blank", "noopener")).toBeNull();
    expect(popupDocument.documentElement.style.backgroundColor).toBe("#000000");
    expect(popupDocument.documentElement.style.colorScheme).toBe("dark");
    expect(popupDocument.body.style.backgroundColor).toBe("#000000");
  });
  it("paints a newly created named window while preserving its proxy", () => {
    const { window, popup, popupDocument } = load();
    expect(window.open("/project", "report", "width=640")).toBe(popup);
    expect(popupDocument.documentElement.style.backgroundColor).toBe("#000000");
    expect(popup.opener).not.toBeNull();
  });
  it("does not overwrite the style of an already loaded named window", () => {
    const { window, popup, popupDocument } = load({
      popupUrl: origin + "/project",
    });
    expect(window.open("/session", "report")).toBe(popup);
    expect(popupDocument.documentElement.style).toEqual({});
    expect(popupDocument.body.style).toEqual({});
  });
  it("can paint an initial document before its body exists", () => {
    const { window, popupDocument } = load({ hasBody: false });
    window.open("/project", "_blank", "noopener");
    expect(popupDocument.documentElement.style.backgroundColor).toBe("#000000");
  });
  it("keeps opener isolation when the initial document cannot be painted", () => {
    const { window, popup, log } = load({ popupDocumentError: true });
    expect(window.open("/project", "_blank", "noopener")).toBeNull();
    expect(popup.opener).toBeNull();
    expect(popup.close).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });
  it.each([
    "/api/sessions/test/export?inline=1",
    "/project?cwd=test",
    "../session",
    "?cwd=test",
  ])("opens %s directly exactly once", (url) => {
    const { window, document, nativeOpen, popup } = load();
    expect(
      window.open(url, "report", "noopener,noreferrer,width=640,height=480"),
    ).toBeNull();
    expect(nativeOpen).toHaveBeenCalledExactlyOnceWith(
      new URL(url, home).href,
      "_blank",
      "width=640,height=480",
    );
    expect(popup.opener).toBeNull();
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(document.createElement).not.toHaveBeenCalled();
    expect(window.location.href).toBe(home);
  });
  it.each([
    "NoOpener = YES",
    "noreferrer=true",
    "noopener=-2",
    "noopener=0,noreferrer=1",
    "noopener=false,noreferrer",
    "noopener=0,noopener=yes",
  ])("parses enabled isolation: %s", (features) => {
    const { window, popup, nativeOpen } = load();
    expect(window.open("/other", "named", features)).toBeNull();
    expect(nativeOpen).toHaveBeenCalledExactlyOnceWith(
      origin + "/other",
      "_blank",
      "",
    );
    expect(popup.opener).toBeNull();
  });
  it.each([
    undefined,
    "",
    "width=640",
    "noopener=0,noreferrer=no",
    "noopener=false",
    "noopener=yes,noopener=0",
  ])(
    "preserves proxies and named contexts without isolation: %s",
    (features) => {
      const { window, popup, nativeOpen } = load();
      expect(window.open("/other", "report", features)).toBe(popup);
      expect(nativeOpen).toHaveBeenCalledExactlyOnceWith(
        "/other",
        "report",
        features,
      );
      expect(popup.opener).not.toBeNull();
    },
  );
  it.each([
    undefined,
    "",
    "  ",
    "#section",
    "about:blank",
    "about:blank#pending",
    "blob:" + origin + "/file",
    "data:text/plain,test",
    "mailto:test@example.com",
    "https://other.example/",
    "http://127.0.0.1:30142/",
    "/auth/sign-in",
  ])("delegates special, cross-origin and auth destinations: %s", (url) => {
    const { window, popup, nativeOpen } = load();
    expect(window.open(url, "_blank", "noopener,noreferrer")).toBe(popup);
    expect(nativeOpen).toHaveBeenCalledExactlyOnceWith(
      url,
      "_blank",
      "noopener,noreferrer",
    );
  });
  it.each(["_self", "_parent", "_top"])(
    "preserves existing context %s",
    (target) => {
      const { window, nativeOpen } = load();
      window.open("/project", target, "noopener");
      expect(nativeOpen).toHaveBeenCalledExactlyOnceWith(
        "/project",
        target,
        "noopener",
      );
    },
  );
  it.each([
    { platform: "Win32" },
    { platform: "Linux x86_64" },
    { enabled: false },
    { frame: true },
  ])("does not install outside its supported context: %j", (options) => {
    const { window, nativeOpen, listeners } = load(options);
    expect(window.open).toBe(nativeOpen);
    expect(listeners).toEqual([]);
  });
  it("leaves the main page unchanged when blocked", () => {
    const { window, popup, nativeOpen } = load({ blocked: true });
    expect(window.open("/other", "_blank", "noopener")).toBeNull();
    expect(nativeOpen).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();
    expect(window.location.href).toBe(home);
  });
  it("closes a new window and warns if isolation fails without retrying", () => {
    const { window, popup, nativeOpen, log } = load({ isolationError: true });
    expect(window.open("/other", "_blank", "noopener")).toBeNull();
    expect(popup.close).toHaveBeenCalledExactlyOnceWith();
    expect(log.warn).toHaveBeenCalled();
    expect(nativeOpen).toHaveBeenCalledTimes(1);
  });
  it("handles implicit isolated links at the final bubbling stage", () => {
    const { click, nativeOpen, popup, listeners } = load();
    const event = click();
    expect(listeners).toEqual([
      { type: "click", handler: expect.any(Function), capture: true },
      { type: "click", handler: expect.any(Function), capture: undefined },
    ]);
    expect(event.defaultPrevented).toBe(true);
    expect(nativeOpen).toHaveBeenCalledExactlyOnceWith(
      origin + "/project",
      "_blank",
      "",
    );
    expect(popup.opener).toBeNull();
  });
  it("shields shell-plugin routing until page cancellation has run", () => {
    const { click, nativeOpen } = load();
    let anchor;
    click("/project", {}, {}, (event, link) => {
      anchor = link;
      expect(link.target).toBe("_BLANK");
      event.preventDefault();
      // The shell plugin ignores defaultPrevented but matches only _blank.
      if (link.target === "_blank") nativeOpen(link.href);
    });
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(anchor.target).toBe("_blank");
  });
  it("preserves a target changed by the page's click handler", () => {
    const { click, nativeOpen } = load();
    click("/project", {}, {}, (_event, anchor) => {
      anchor.target = "_self";
    });
    expect(nativeOpen).not.toHaveBeenCalled();
  });
  it.each(["noopener", "noreferrer", "NoReferrer noopener", "opener noopener"])(
    "handles link rel=%s once",
    (rel) => {
      const { click, nativeOpen } = load();
      expect(click("/session", {}, { rel }).defaultPrevented).toBe(true);
      expect(nativeOpen).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { defaultPrevented: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("respects page cancellation and modified clicks: %j", (overrides) => {
    const { click, nativeOpen } = load();
    click("/project", overrides);
    expect(nativeOpen).not.toHaveBeenCalled();
  });
  it.each([
    ["/project", { download: "" }],
    ["/project", { rel: "opener" }],
    ["/project", { target: "frame" }],
    ["/project", { target: "_self" }],
    ["/auth/start", {}],
    ["https://other.example/", {}],
    ["#section", {}],
    ["blob:" + origin + "/file", {}],
  ])("leaves excluded links with native handling: %s %j", (href, attrs) => {
    const { click, nativeOpen } = load();
    expect(click(href, {}, attrs).defaultPrevented).toBe(false);
    expect(nativeOpen).not.toHaveBeenCalled();
  });
  it("respects Pake's forced current-window link navigation", () => {
    const { click, nativeOpen } = load({ forceInternal: true });
    expect(click().defaultPrevented).toBe(false);
    expect(nativeOpen).not.toHaveBeenCalled();
  });
});
