/* Google Play purchase buttons for the Android app. Only does anything when native-bridge.js
 * has exposed window.NativeBilling, so the web build keeps its testing preview unchanged. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.NotebookBilling = api; api.start(root); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PRO = "homelabnotebook_pro_unlock";
  const TIPS = ["homelabnotebook_tip_small", "homelabnotebook_tip_medium", "homelabnotebook_tip_large"];
  const TIP_NAMES = ["Small tip", "A little extra", "Big thanks"];

  function view(state) {
    const s = state || {}, prices = s.prices || {}, ready = s.status === "ready", price = prices[PRO];
    let status;
    if (s.status === "connecting" || !s.status) status = "Checking Google Play…";
    else if (!ready) {
      status = s.message || "Google Play isn’t available here, so purchases can’t be made or checked right now.";
      if (s.pro && s.source === "cache") status += " You can still use Pro based on the last time Google Play checked your purchase.";
    } else if (s.pro) status = "Pro is yours for good. Thanks for buying it.";
    else if (s.proPending) status = "Your payment is still going through. Pro will be ready when Google Play confirms it.";
    else if (!price) status = "Pro isn’t on sale in Google Play yet. The free notebook is ready to use.";
    else status = "Pay once for Pro. The free notebook stays free.";
    if (ready && s.message) status += " " + s.message;
    const pending = Array.isArray(s.pendingTips) ? s.pendingTips : [];
    return {
      pro: s.pro === true,
      supporter: false,
      status,
      proName: s.pro ? "Pro is yours" : s.proPending ? "Payment pending" : "Get Pro",
      proPrice: s.pro || s.proPending ? "" : (price || ""),
      proLabel: s.pro ? "Pro is yours" : s.proPending ? "Payment pending" : price ? `Get Pro (${price})` : "Get Pro",
      proDisabled: !!(s.pro || s.proPending || !ready || !price),
      tips: TIPS.map((id, i) => ({
        id,
        name: pending.includes(id) ? "Tip pending" : TIP_NAMES[i],
        price: pending.includes(id) || !prices[id] ? "" : prices[id],
        label: pending.includes(id) ? "Tip pending" : prices[id] ? `${TIP_NAMES[i]} (${prices[id]})` : TIP_NAMES[i],
        disabled: !ready || !prices[id] || pending.includes(id)
      }))
    };
  }

  function outcomeMessage(result, productId) {
    const r = result || {};
    switch (r.outcome) {
      case "purchased": return TIPS.includes(productId) ? "Thanks for the tip. It means a lot!" : "Pro is yours. Thanks for supporting the app!";
      case "pending": return "Payment pending. We’ll pick it up when Google Play confirms it, even if you close the app.";
      case "cancelled": return "No problem. Nothing was charged.";
      case "owned": return "You already own this, so it’s been restored.";
      default: return r.reason || "Google Play couldn’t finish that. Try again in a bit.";
    }
  }

  function restoreMessage(state) {
    const s = state || {};
    if (s.status !== "ready") return s.message || "Couldn’t reach Google Play to check your purchases. Try again later.";
    if (s.pro) return "Restored. Pro is ready to use.";
    if (s.pendingTips && s.pendingTips.length) return "Your tip payment is still pending with Google Play.";
    if (s.message) return s.message;
    if (s.proPending) return "Your Pro payment is still pending with Google Play.";
    return "No purchases found on this Google account.";
  }

  const CSS = '.billing-pro{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px;margin:0 0 14px}.billing-pro #buyPro,.billing-tips button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:4.5rem;height:100%;white-space:normal;text-align:center;line-height:1.25}.billing-pro #buyPro{flex:1 1 12rem}.billing-pro #restorePurchases{flex:1 1 8rem}.billing-tips{display:grid;grid-template-columns:1fr;gap:10px;margin:0 0 10px}.billing-tips .quiet,.support-restore{width:100%;margin-top:10px}@media(min-width:640px){.billing-tips{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}}.buy-name,.buy-price{display:block}.buy-price{font-size:.85em;font-weight:650}.billing-pro button[disabled],.billing-tips button[disabled]{opacity:.6;cursor:default}.billing-status{margin:0 0 14px}';

  function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function face(name, price) { return price ? `<span class="buy-name">${esc(name)}</span><span class="buy-price">${esc(price)}</span>` : `<span class="buy-name">${esc(name)}</span>`; }

  function start(win) {
    const doc = win && win.document, native = win && win.NativeBilling;
    if (!doc || !native || !native.getState) return;
    const E = win.NotebookEntitlement;
    if (!E || !E.setStore) return;
    E.setStore(E.usesStore && E.usesStore() ? { pro: E.hasPro(), supporter: E.isSupporter() } : { pro: false, supporter: false });
    if (!doc.getElementById("billingStyle")) {
      const style = doc.createElement("style");
      style.id = "billingStyle";
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
    const toggle = doc.getElementById("previewPro");
    if (toggle && toggle.closest("label")) toggle.closest("label").hidden = true;
    const profile = doc.getElementById("proCard");
    const support = doc.getElementById("supportCard");
    if (profile && !profile.querySelector(".billing-pro")) {
      const bar = doc.createElement("div");
      bar.className = "billing-pro";
      bar.id = "billingBar";
      bar.innerHTML = '<button id="buyPro" type="button"><span class="buy-name">Get Pro</span></button><button id="restorePurchases" type="button" class="quiet">Restore purchases</button>';
      const status = doc.createElement("p");
      status.id = "billingStatus";
      status.className = "help billing-status";
      status.setAttribute("role", "status");
      const heading = profile.querySelector("h2, .section-heading");
      if (heading) heading.after(bar, status);
      else profile.prepend(bar, status);
    }
    if (support && !support.querySelector(".billing-tips")) {
      support.hidden = false;
      const mount = doc.getElementById("supportMount") || support;
      const grid = doc.createElement("div");
      grid.className = "billing-tips";
      grid.id = "billingTips";
      grid.innerHTML = TIPS.map((id, i) => `<button id="${id}" type="button" class="secondary"><span class="buy-name">${TIP_NAMES[i]}</span></button>`).join("");
      const restore = doc.createElement("button");
      restore.id = "restorePurchases";
      restore.type = "button";
      restore.className = "quiet support-restore";
      restore.textContent = "Restore purchases";
      mount.append(grid, restore);
    }
    wire(win, doc, native, E, !!(profile || support));
  }

  function wire(win, doc, native, E, hasBar) {
    const $ = (id) => doc.getElementById(id);
    let current = { status: "connecting" }, busy = false;
    const toast = (text) => {
      const A = win.HomelabNotebook;
      if (A && A.toast) { A.toast(text); return; }
      const el = doc.getElementById("toast");
      if (el) {
        el.textContent = text;
        el.classList.add("show");
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove("show"), 3000);
        return;
      }
      const status = $("billingStatus");
      if (status) status.textContent = text;
    };
    function paint() {
      if (!hasBar) return;
      const v = view(current);
      doc.querySelectorAll("#buyPro").forEach((button) => { button.innerHTML = face(v.proName, v.proPrice); button.disabled = busy || v.proDisabled; });
      v.tips.forEach((t) => { doc.querySelectorAll("#" + t.id).forEach((button) => { button.innerHTML = face(t.name, t.price); button.disabled = busy || t.disabled; }); });
      doc.querySelectorAll("#restorePurchases").forEach((button) => { button.disabled = busy; });
      const status = $("billingStatus");
      if (status) status.textContent = v.status;
    }
    function remember(next) {
      try {
        if (next && next.pro === true) localStorage.setItem("homelab-notebook-pro", "true");
        else localStorage.removeItem("homelab-notebook-pro");
      } catch (e) { /* ignore quota */ }
    }
    function apply(next) {
      if (!next || typeof next !== "object") return;
      const had = E.hasPro();
      current = next;
      E.setStore({ pro: next.pro === true, supporter: next.supporter === true });
      remember(next);
      paint();
      if (had !== E.hasPro()) win.dispatchEvent(new win.Event("notebook:entitlement"));
      else win.dispatchEvent(new win.Event("notebook:pro"));
    }
    async function run(fn) { if (busy) return; busy = true; paint(); try { return await fn(); } finally { busy = false; paint(); } }
    async function buy(productId) {
      await run(async () => {
        let result;
        try { result = await native.purchase(productId); } catch (e) { result = { outcome: "error" }; }
        apply(result && result.status ? result : current);
        toast(outcomeMessage(result, productId));
      });
    }
    if (hasBar) {
      doc.querySelectorAll("#buyPro").forEach((button) => button.addEventListener("click", () => buy(PRO)));
      TIPS.forEach((id) => doc.querySelectorAll("#" + id).forEach((button) => button.addEventListener("click", () => buy(id))));
      doc.querySelectorAll("#restorePurchases").forEach((button) => button.addEventListener("click", () => run(async () => {
        let s;
        try { s = await native.restore(); } catch (e) { s = { status: "error", message: "Couldn’t reach Google Play to check your purchases. Try again later." }; }
        apply(s);
        toast(restoreMessage(s));
      })));
      paint();
    }
    try { native.onUpdate(apply); } catch (e) { /* plugin may not expose a listener yet */ }
    Promise.resolve().then(() => native.getState()).then(apply, () => apply({ status: "unavailable", message: "Google Play billing isn’t available on this device." }));
  }

  return { view, outcomeMessage, restoreMessage, start, PRO, TIPS };
});
