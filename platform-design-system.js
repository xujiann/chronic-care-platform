(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthPlatformDesign = api;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  "use strict";

  const tokens = Object.freeze({
    colorBrand: "#146c94",
    colorFocus: "#0b74de",
    colorDanger: "#b42318",
    surface: "#ffffff",
    text: "#172b3a",
    radius: "10px",
    space: "8px"
  });

  function install(documentRef = root.document) {
    if (!documentRef || documentRef.getElementById("health-platform-design-tokens")) return;
    const style = documentRef.createElement("style");
    style.id = "health-platform-design-tokens";
    style.textContent = `
      :root {
        --hp-color-brand: ${tokens.colorBrand};
        --hp-color-focus: ${tokens.colorFocus};
        --hp-color-danger: ${tokens.colorDanger};
        --hp-surface: ${tokens.surface};
        --hp-text: ${tokens.text};
        --hp-radius: ${tokens.radius};
        --hp-space: ${tokens.space};
      }
      :where(a, button, input, select, textarea):focus-visible {
        outline: 3px solid var(--hp-color-focus);
        outline-offset: 2px;
      }
      .hp-visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `;
    documentRef.head.appendChild(style);
  }

  return Object.freeze({ install, tokens });
});
