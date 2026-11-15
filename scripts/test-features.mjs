import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Core = require(path.join(root, "labs-core.js"));
const app = require(path.join(root, "app.js"));
const Entitlement = require(path.join(root, "entitlement.js"));
const Billing = require(path.join(root, "billing-ui.js"));
const parts = JSON.parse(fs.readFileSync(path.join(root, "data/power-parts.json"), "utf8"));
const vectors = JSON.parse(fs.readFileSync(path.join(root, "interop/test-vectors.json"), "utf8"));

// --- existing app helpers still work with new host fields ---
assert.equal(app.normalizeIp("  192.168.1.10 "), "192.168.1.10");
const lab = app.exampleLab();
assert.ok(lab.hosts.length >= 8);
const cleaned = app.normalizeLab({
  hosts: [{ name: "lone", type: "vm", parentId: "missing", idleWatts: "8.5", services: [{ name: "web", port: 80 }] }]
});
assert.equal(cleaned.hosts[0].parentId, "");
assert.equal(cleaned.hosts[0].idleWatts, 8.5);
assert.equal(cleaned.hosts[0].services[0].port, "80");

// --- watts, guests, circuit ---
const sample = {
  version: 1,
  voltageMode: "120",
  voltage: 120,
  breaker: 15,
  hosts: [
    { id: "pve", name: "pve1", type: "proxmox-node", idleWatts: 8, loadWatts: 35, loadPct: 20, hours: 24 },
    { id: "ha", name: "haos", type: "vm", parentId: "pve", idleWatts: 20, loadWatts: 40 },
    { id: "pi", name: "pi-dns", type: "pi", idleWatts: 3, loadWatts: 8, loadPct: 20 }
  ]
};
const power = Core.labPower(sample);
assert.ok(Core.isWallHost(sample.hosts[0]));
assert.equal(Core.isWallHost(sample.hosts[1]), false);
assert.equal(power.counted, 2);
assert.ok(Math.abs(power.idleTotal - 11) < 1e-9);
assert.equal(power.limit, 120 * 15 * 0.8);
assert.equal(power.over80, false);
const heavy = Core.labPower({
  ...sample,
  hosts: [{ id: "rack", name: "rack", type: "other", idleWatts: 800, loadWatts: 2000, loadPct: 100 }]
});
assert.equal(heavy.over80, true);

const suggestion = Core.suggestWatts("pi", null, parts);
assert.ok(suggestion && suggestion.idle > 0);
assert.ok(suggestion.partId.includes("raspberry-pi"));

// --- uptime stale after 90 days, missing backup ---
const now = Date.parse("2026-11-15T12:00:00Z");
const flags = Core.hostUptime({ backupLocation: "", lastUpdated: "2026-01-01", warrantyDate: "2020-01-01" }, now);
assert.equal(flags.backupMissing, true);
assert.equal(flags.staleUpdate, true);
assert.equal(flags.warrantyExpired, true);
assert.equal(flags.stale, true);
const fresh = Core.hostUptime({ backupLocation: "NAS", lastUpdated: "2026-11-01" }, now);
assert.equal(fresh.stale, false);

// --- labs book ---
const book = Core.createBook(app.emptyLab ? app.emptyLab() : { version: 1, hosts: [] }, "My first lab");
assert.equal(book.labs.length, 1);
assert.throws(() => Core.addLab(book, "My first lab", { version: 1, hosts: [] }), /already have a lab/);

// --- share #n= round trip ---
const shared = await Core.encodeShare(sample, "Interop sample");
assert.match(shared, /^n=[jz]\./);
const opened = await Core.decodeShare(shared);
assert.equal(opened.hosts.length, sample.hosts.length);
assert.equal(opened.hosts[0].name, "pve1");

// --- #p= interchange ---
const payload = Core.toInterop(sample, "Interop sample", "homelab-notebook");
assert.equal(payload.v, 1);
assert.equal(payload.source, "homelab-notebook");
const pToken = await Core.encodeInterop(payload);
assert.match(pToken, /^p=[jz]\./);
const back = await Core.decodeInterop("#" + pToken);
assert.equal(back.devices.length, 3);
const asLab = Core.hostsFromInterop(back, parts);
assert.ok(asLab.hosts.some((h) => h.name === "pve1" && h.idleWatts === 8));

// --- #s= via Notebook, then Power's own decode/normalize ---
const state = Core.toPowerState(sample);
assert.equal(state.version, 1);
assert.ok(state.devices.every((d) => d.name !== "haos"), "guest VMs must not be sent as wall-power devices");
assert.equal(state.devices.length, 2);
const sToken = Core.encodePowerSShare(state);
assert.match(sToken, /^s=/);

const PowerMath = require("/workspace/homelab-power-calculator/math.js");
const RegionRates = require("/workspace/homelab-power-calculator/regions.js");
const powerApp = fs.readFileSync("/workspace/homelab-power-calculator/app.js", "utf8");
const start = powerApp.indexOf("function normalize(raw){");
const end = powerApp.indexOf("let state,loadMessage='',stateOrigin='demo';");
assert.ok(start >= 0 && end > start);
const sandbox = {
  PowerMath,
  RegionRates,
  TextEncoder,
  TextDecoder,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Uint8Array
};
vm.createContext(sandbox);
const extracted = [
  "const M = PowerMath;",
  "const regions = RegionRates.regions;",
  "const currencies = ['USD','EUR','GBP','CAD','AUD','JPY','INR'];",
  "const num = (v, lo, hi, fallback = 0) => Number.isFinite(M.parse(v)) ? M.clamp(v, lo, hi) : fallback;",
  "let nextId = 1;",
  "const uid = () => 'd' + nextId++;",
  powerApp.slice(start, end),
  "this.__power = { normalize, encode, decode };"
].join("\n");
vm.runInContext(extracted, sandbox);
const PowerShare = sandbox.__power;
const decoded = PowerShare.decode("#" + sToken);
assert.equal(decoded.version, 1);
assert.equal(decoded.devices.length, 2);
const pve = decoded.devices.find((d) => d.name === "pve1");
assert.ok(pve);
assert.equal(pve.idle, 8);
assert.equal(pve.load, 35);
assert.equal(decoded.voltage, 120);
assert.equal(decoded.breaker, 15);
const reencoded = "s=" + PowerShare.encode(decoded);
const again = PowerShare.decode("#" + reencoded);
assert.equal(again.devices[0].idle, decoded.devices[0].idle);

// published test vectors also round-trip through Power
const fromVector = PowerShare.decode("#" + vectors.tokens.s);
assert.equal(fromVector.version, 1);
assert.ok(fromVector.devices.some((d) => d.name === "pve1"));

// parse incoming #s= / #p=
const fromS = await Core.parseIncomingLink("https://heemsec.github.io/homelab-power/#" + sToken, parts);
assert.equal(fromS.kind, "power-calc");
assert.ok(fromS.lab.hosts.some((h) => h.name === "pve1"));
const fromP = await Core.parseIncomingLink("#" + pToken, parts);
assert.equal(fromP.kind, "interop");

// merge / re-sync by powerId
const current = {
  version: 1,
  hosts: [
    { id: "keep", name: "pve1", type: "proxmox-node", powerId: "host-pve1", idleWatts: 8, loadWatts: 35, services: [] }
  ]
};
const incoming = {
  version: 1,
  hosts: [
    { id: "new", name: "pve1", type: "proxmox-node", powerId: "host-pve1", idleWatts: 10, loadWatts: 40, services: [] },
    { id: "extra", name: "switch-8", type: "switch", powerId: "sw-1", idleWatts: 4, services: [] }
  ]
};
const merged = Core.mergeLabs(current, incoming);
assert.equal(merged.updated, 1);
assert.equal(merged.added, 1);
assert.equal(merged.lab.hosts.find((h) => h.id === "keep").idleWatts, 10);

// backup + csv
const csv = Core.toCsv(sample);
assert.match(csv, /Name,Type,IP/);
assert.match(csv, /pve1/);
const backup = Core.makeBackup(book);
assert.equal(backup.app, "homelab-notebook");
assert.equal(backup.version, 1);
assert.doesNotThrow(() => Core.readBackup(backup));
assert.throws(() => Core.readBackup({ app: "nope", version: 1 }), /isn't a Homelab Notebook backup/);

// starters are generic
for (const t of Core.starterTemplates()) {
  const built = t.build();
  assert.ok(built.hosts.length >= 2, t.id);
  const blob = JSON.stringify(built).toLowerCase();
  assert.doesNotMatch(blob, /heemsec|nick|restaurant/);
}

// entitlement: web preview, store mode ignores preview
const E = Entitlement;
E.setPreview(true);
assert.equal(E.hasPro(), true);
assert.equal(E.isPreview(), true);
E.setPreview(false);
E.setStore({ pro: true });
E.setPreview(true);
assert.equal(E.hasPro(), true);
assert.equal(E.isPreview(), false);
E.setStore({ pro: false });
assert.equal(E.hasPro(), false);

// billing product ids are namespaced
assert.equal(Billing.PRO, "homelabnotebook_pro_unlock");
assert.deepEqual(Billing.TIPS, [
  "homelabnotebook_tip_small",
  "homelabnotebook_tip_medium",
  "homelabnotebook_tip_large"
]);
const view = Billing.view({
  status: "ready",
  pro: false,
  prices: { homelabnotebook_pro_unlock: "$2.99", homelabnotebook_tip_small: "$0.99" }
});
assert.match(view.proLabel, /Get Pro/);
assert.equal(view.tips[0].price, "$0.99");

console.log("feature tests passed");
