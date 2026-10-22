import assert from "node:assert/strict";
import { test } from "node:test";
import { load, origin, home } from "./fixtures/popup.mjs";

const calls = (fn) => fn.mock.calls.map(({ arguments: args }) => args);

test("opens an isolated popup directly once and paints the pending document black", () => {
  const {
    window,
    nativeOpen,
    popup,
    popupDocument,
    document,
    listeners,
    reinstall,
  } = load();
  const open = window.open;
  const installedListeners = [...listeners];
  reinstall();
  assert.equal(window.open, open);
  assert.deepEqual(listeners, installedListeners);
  assert.equal(
    window.open("/project", "report", "noopener,noreferrer,width=640"),
    null,
  );
  assert.deepEqual(calls(nativeOpen), [
    [origin + "/project", "_blank", "width=640"],
  ]);
  assert.equal(popup.opener, null);
  assert.equal(popupDocument.documentElement.style.backgroundColor, "#000000");
  assert.equal(popupDocument.documentElement.style.colorScheme, "dark");
  assert.equal(popupDocument.body.style.backgroundColor, "#000000");
  assert.equal(popup.location.replace.mock.callCount(), 0);
  assert.equal(document.createElement.mock.callCount(), 0);
  assert.equal(window.location.href, home);
});

test("preserves normal named proxies and an existing document's styles", () => {
  const { window, popup, nativeOpen, popupDocument } = load({
    popupUrl: origin + "/project",
  });
  assert.equal(window.open("/session", "report", "width=640"), popup);
  assert.deepEqual(calls(nativeOpen), [["/session", "report", "width=640"]]);
  assert.notEqual(popup.opener, null);
  assert.deepEqual(popupDocument.documentElement.style, {});
  assert.deepEqual(popupDocument.body.style, {});
});

test("delegates special, external, auth and existing-context targets", () => {
  const { window, popup, nativeOpen } = load();
  const destinations = [
    "about:blank",
    "#section",
    "https://other.example/",
    "/auth/sign-in",
  ];
  for (const url of destinations) {
    assert.equal(window.open(url, "_blank", "noopener"), popup);
  }
  assert.equal(window.open("/project", "_self", "noopener"), popup);
  assert.deepEqual(calls(nativeOpen), [
    ...destinations.map((url) => [url, "_blank", "noopener"]),
    ["/project", "_self", "noopener"],
  ]);
});

test("does not install outside the supported context", () => {
  for (const options of [
    { platform: "Win32" },
    { enabled: false },
    { frame: true },
  ]) {
    const { window, nativeOpen, listeners } = load(options);
    assert.equal(window.open, nativeOpen);
    assert.deepEqual(listeners, []);
  }
});

test("handles an ordinary isolated link once after page handlers", () => {
  const { click, nativeOpen, popup, reinstall } = load();
  reinstall();
  const event = click("/project", {}, {}, (_event, anchor) => {
    assert.equal(anchor.target, "_BLANK");
  });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls(nativeOpen), [[origin + "/project", "_blank", ""]]);
  assert.equal(popup.opener, null);
});

test("respects cancellation, modifiers and current-window navigation", () => {
  const { click, nativeOpen } = load();
  click("/project", {}, {}, (event) => event.preventDefault());
  click("/project", { ctrlKey: true });
  click("/project", {}, {}, (_event, anchor) => {
    anchor.target = "_self";
  });
  assert.equal(nativeOpen.mock.callCount(), 0);
  const forced = load({ forceInternal: true });
  assert.equal(forced.click().defaultPrevented, false);
  assert.equal(forced.nativeOpen.mock.callCount(), 0);
});

test("closes the popup without retrying when isolation fails", () => {
  const { window, popup, nativeOpen, log } = load({ isolationError: true });
  assert.equal(window.open("/project", "_blank", "noopener"), null);
  assert.equal(popup.close.mock.callCount(), 1);
  assert.equal(nativeOpen.mock.callCount(), 1);
  assert.equal(log.warn.mock.callCount(), 1);
});

test("leaves the main page unchanged when a popup is blocked", () => {
  const { window, popup, nativeOpen } = load({ blocked: true });
  assert.equal(window.open("/project", "_blank", "noopener"), null);
  assert.equal(nativeOpen.mock.callCount(), 1);
  assert.equal(popup.close.mock.callCount(), 0);
  assert.equal(window.location.href, home);
});
