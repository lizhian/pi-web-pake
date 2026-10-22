import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { mock } from "node:test";

const source = fs.readFileSync(
  new URL("../../scripts/pi-web-inject.js", import.meta.url),
  "utf8",
);
export const origin = "http://127.0.0.1:30141";
export const home = origin + "/app/index?session=test";

export function load({
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
    location: { replace: mock.fn() },
    close: mock.fn(),
  };
  const nativeOpen = mock.fn(() => (blocked ? null : popup));
  const listeners = [];
  const document = {
    baseURI: home,
    createElement: mock.fn(),
    addEventListener: (type, handler, capture) =>
      listeners.push({ type, handler, capture }),
  };
  const log = { warn: mock.fn() };
  const window = {
    location: { href: home, origin },
    pakeConfig: {
      new_window: enabled,
      force_internal_navigation: forceInternal,
    },
    open: nativeOpen,
    addEventListener: (type, handler, capture) =>
      listeners.push({ type, handler, capture }),
    isAuthPopup: mock.fn((url) => url.includes("/auth/")),
    isAuthLink: mock.fn((url) => url.includes("/auth/")),
  };
  window.top = frame ? {} : window;
  runInNewContext(source, {
    URL,
    console: log,
    navigator: { platform },
    window,
    document,
    setTimeout: mock.fn(),
    clearTimeout: mock.fn(),
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
      preventDefault: mock.fn(function () {
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
