/* Applies light/dark before the stylesheet paints. */
(() => {
  "use strict";
  const media = matchMedia("(prefers-color-scheme: light)");
  let mode;
  try { mode = localStorage.getItem("homelab-notebook-theme"); } catch {}
  if (mode === "system") mode = null;
  if (!["light", "dark"].includes(mode)) mode = null;
  function resolveMode() {
    return mode === "light" || mode === "dark" ? mode : (media.matches ? "light" : "dark");
  }
  function apply() {
    const theme = resolveMode();
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#F7FBFE" : "#0B1628";
    const button = document.getElementById("theme");
    if (button) {
      button.textContent = theme === "light" ? "Dark mode" : "Light mode";
      button.setAttribute("aria-label", `Switch to ${theme === "light" ? "dark" : "light"} mode`);
      button.setAttribute("aria-pressed", String(theme === "light"));
    }
  }
  apply();
  media.addEventListener("change", () => { if (!mode) apply(); });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    const button = document.getElementById("theme");
    if (!button) return;
    button.addEventListener("click", () => {
      mode = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      apply();
      try { localStorage.setItem("homelab-notebook-theme", mode); } catch {}
    });
  });
})();
