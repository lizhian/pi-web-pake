// Observe the native delegate before the adapter wraps it.
if (location.pathname === "/") {
  const delegate = window.open;
  window.open = function (url, target, features) {
    fetch("/report/delegate", {
      method: "POST",
      body: JSON.stringify({ url, target, features }),
    });
    const popup = delegate.call(this, url, target, features);
    if (String(url).endsWith("/popup/loading") && popup) {
      queueMicrotask(() => {
        try {
          const initial = popup.document;
          fetch("/report/loading", {
            method: "POST",
            body: JSON.stringify({
              url: initial.URL,
              background: popup.getComputedStyle(initial.documentElement)
                .backgroundColor,
              colorScheme: popup.getComputedStyle(initial.documentElement)
                .colorScheme,
              bodyBackground: popup.getComputedStyle(initial.body)
                .backgroundColor,
            }),
          });
        } catch (error) {
          fetch("/report/error", {
            method: "POST",
            body: JSON.stringify(String(error)),
          });
        }
      });
    }
    return popup;
  };
}
