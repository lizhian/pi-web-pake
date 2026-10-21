(function () {
  const INJECT_STYLE_KEY = "__PAKE_INJECT_STYLE__";
  const adoptedSheetsById = new Map();

  if (typeof window[INJECT_STYLE_KEY] === "function") {
    return;
  }

  function containsImport(css) {
    // Skip comments, strings and escaped delimiters; decode at-keyword escapes. Import
    // rules are case-insensitive and need not begin a line. replaceSync silently
    // drops them, so a blocked sheet containing imports must keep its DOM path.
    const tokens =
      /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\\(?:[0-9a-f]{1,6}[\t\n\f\r ]?|[^\n\r\f])|@((?:[-\w\u0080-\uffff]|\\(?:[0-9a-f]{1,6}[\t\n\f\r ]?|[^\n\r\f]))+)/gi;
    for (const token of css.matchAll(tokens)) {
      if (!token[1]) continue;
      const keyword = token[1].replace(
        /\\([0-9a-f]{1,6})[\t\n\f\r ]?|\\([^\n\r\f])/gi,
        (_escape, hex, character) => {
          const code = hex ? parseInt(hex, 16) : 0;
          return hex
            ? String.fromCodePoint(code > 0 && code <= 0x10ffff ? code : 0xfffd)
            : character;
        },
      );
      if (keyword.toLowerCase() === "import") return true;
    }
    return false;
  }

  function injectWithAdoptedStyleSheet(css, id) {
    try {
      if (
        typeof window.CSSStyleSheet !== "function" ||
        !("adoptedStyleSheets" in document) ||
        containsImport(css)
      ) {
        return null;
      }

      const currentSheets = document.adoptedStyleSheets;
      const sheet = new window.CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = Array.from(currentSheets).concat(sheet);

      if (!Array.from(document.adoptedStyleSheets).includes(sheet)) {
        return null;
      }

      if (id) {
        adoptedSheetsById.set(id, sheet);
      }
      return sheet;
    } catch (_error) {
      return null;
    }
  }

  window[INJECT_STYLE_KEY] = function (css, id) {
    if (id) {
      const existingElement = document.getElementById(id);
      if (existingElement) {
        return existingElement;
      }

      const existingSheet = adoptedSheetsById.get(id);
      if (existingSheet) {
        try {
          if (Array.from(document.adoptedStyleSheets).includes(existingSheet)) {
            return existingSheet;
          }
        } catch (_error) {
          // Recreate the sheet when the document's adopted-sheet list is unavailable.
        }
        adoptedSheetsById.delete(id);
      }
    }

    const style = document.createElement("style");
    if (id) {
      style.id = id;
    }
    style.textContent = css;
    (document.head || document.body || document.documentElement)?.appendChild(
      style,
    );

    // Preserve normal DOM cascade order, including custom CSS with imports.
    // CSP-blocked style elements have no associated sheet. Only those need the
    // constructable-sheet fallback; imports remain subject to the page's CSP.
    if (!style.sheet) {
      const sheet = injectWithAdoptedStyleSheet(css, id);
      if (sheet) {
        style.remove();
        return sheet;
      }
    }
    return style;
  };
})();
