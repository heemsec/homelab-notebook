/* Pure helpers for labs, share links, Power interop, uptime, and power math.
 * No DOM, billing, or network. Safe to unit test in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NotebookCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MONTH_DAYS = 365 / 12;
  const STALE_DAYS = 90;
  const MAX_LABS = 20;
  const MAX_HOSTS = 200;
  const MAX_DEVICES = 100;
  const MAX_HASH = 100000;
  const GUESTS = { vm: true, lxc: true };

  const TYPE_PARTS = {
    router: "ubiquiti-unifi-dream-machine-pro-udm-pro",
    switch: "ubiquiti-usw-lite-8-poe",
    firewall: "topton-cwwk-n100-4x-i226-v-firewall-box",
    "proxmox-node": "beelink-eq12-n100",
    pi: "raspberry-pi-raspberry-pi-5-8gb",
    nas: "diy-truenas-unraid-box-i3-4x-3-5-hdd"
  };

  const TYPE_WATTS = {
    router: { idle: 12, load: 16 },
    switch: { idle: 8, load: 15 },
    firewall: { idle: 11, load: 14 },
    "proxmox-node": { idle: 8, load: 35 },
    pi: { idle: 3, load: 8 },
    nas: { idle: 35, load: 57 }
  };

  const CATEGORY_TYPE = {
    "router-firewall": "router",
    switch: "switch",
    nas: "nas",
    sbc: "pi",
    "mini-pc": "proxmox-node",
    "rack-server": "proxmox-node",
    "access-point": "other"
  };

  function uid() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function finite(v) {
    const n = typeof v === "number" ? v : Number(String(v ?? "").trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function clampNum(v, lo, hi) {
    const n = finite(v);
    if (n == null) return null;
    return Math.max(lo, Math.min(hi, n));
  }

  function isGuest(type) {
    return !!GUESTS[type];
  }

  function isWallHost(host) {
    return host && !isGuest(host.type);
  }

  function partById(parts, id) {
    if (!id || !Array.isArray(parts)) return null;
    return parts.find((p) => p.id === id) || null;
  }

  function suggestWatts(type, partId, parts) {
    const part = partById(parts, partId) || partById(parts, TYPE_PARTS[type]);
    if (part) {
      const idle = finite(part.idleW);
      const load = finite(part.typicalW) ?? finite(part.maxW) ?? idle;
      if (idle != null) return { idle, load: load ?? idle, partId: part.id, source: "part" };
    }
    const preset = TYPE_WATTS[type];
    if (preset) return { idle: preset.idle, load: preset.load, partId: TYPE_PARTS[type] || "", source: "type" };
    return null;
  }

  function wattsOf(host) {
    const idle = clampNum(host && host.idleWatts, 0, 100000);
    if (idle == null) return null;
    const load = clampNum(host.loadWatts, 0, 100000);
    const loadPct = clampNum(host.loadPct, 0, 100);
    const pct = loadPct == null ? 20 : loadPct;
    const high = load == null ? idle : load;
    const hours = clampNum(host.hours, 0, 24);
    const hrs = hours == null ? 24 : hours;
    const average = idle + (high - idle) * (pct / 100);
    return { idle, load: high, loadPct: pct, hours: hrs, average };
  }

  function defaultCircuit(lab) {
    const mode = lab && (lab.voltageMode === "230" || lab.voltageMode === "custom" || lab.voltageMode === "120")
      ? lab.voltageMode
      : "120";
    const voltage = mode === "230" ? 230 : mode === "120" ? 120 : clampNum(lab && lab.voltage, 50, 480) || 120;
    const breaker = clampNum(lab && lab.breaker, 1, 200) || (voltage >= 200 ? 16 : 15);
    return { voltageMode: mode, voltage, breaker };
  }

  function labPower(lab) {
    const hosts = (lab && lab.hosts) || [];
    const circuit = defaultCircuit(lab);
    let idleTotal = 0;
    let averageTotal = 0;
    let peakTotal = 0;
    let counted = 0;
    const missing = [];
    for (const host of hosts) {
      if (!isWallHost(host)) continue;
      const w = wattsOf(host);
      if (!w) {
        missing.push(host);
        continue;
      }
      counted += 1;
      idleTotal += w.idle;
      averageTotal += w.average;
      peakTotal += w.load;
    }
    const capacity = circuit.voltage * circuit.breaker;
    const limit = capacity * 0.8;
    const monthKwh = (averageTotal * 24 * MONTH_DAYS) / 1000;
    const peakRatio = capacity ? peakTotal / capacity : 0;
    return {
      circuit,
      capacity,
      limit,
      idleTotal,
      averageTotal,
      peakTotal,
      monthKwh,
      peakRatio,
      over80: peakTotal > limit + 1e-9,
      counted,
      missing
    };
  }

  function parseDate(value) {
    const s = String(value || "").trim();
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  function hostUptime(host, now) {
    const when = now || Date.now();
    const backupMissing = !String(host && host.backupLocation || "").trim();
    const updated = parseDate(host && host.lastUpdated);
    const staleUpdate = !updated || when - updated > STALE_DAYS * 86400000;
    const warranty = parseDate(host && host.warrantyDate);
    const warrantyExpired = warranty != null && warranty < when;
    return {
      backupMissing,
      staleUpdate,
      warrantyExpired,
      stale: backupMissing || staleUpdate
    };
  }

  function labUptime(lab, now) {
    const hosts = (lab && lab.hosts) || [];
    const flags = hosts.map((h) => ({ host: h, ...hostUptime(h, now) }));
    return {
      flags,
      stale: flags.filter((f) => f.stale).length,
      backupMissing: flags.filter((f) => f.backupMissing).length,
      staleUpdate: flags.filter((f) => f.staleUpdate).length,
      warrantyExpired: flags.filter((f) => f.warrantyExpired).length
    };
  }

  function sanitizeName(value, fallback) {
    const n = String(value == null ? "" : value).trim().slice(0, 60);
    return n || fallback || "Untitled lab";
  }

  function createBook(lab, name) {
    const item = {
      id: uid(),
      name: sanitizeName(name, "My first lab"),
      state: lab
    };
    return { version: 1, activeId: item.id, labs: [item] };
  }

  function readBook(raw, normalizeLab) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.labs) || !raw.labs.length || raw.labs.length > MAX_LABS) {
      throw new Error("Couldn't read the saved labs.");
    }
    const ids = new Set();
    const labs = raw.labs.map((item) => {
      if (!item || !/^[\w-]{1,80}$/.test(String(item.id || "")) || ids.has(item.id)) {
        throw new Error("A saved lab had a bad id, so the list couldn't be opened.");
      }
      ids.add(item.id);
      return { id: item.id, name: sanitizeName(item.name, "Lab"), state: normalizeLab(item.state) };
    });
    return { version: 1, activeId: ids.has(raw.activeId) ? raw.activeId : labs[0].id, labs };
  }

  function activeLab(book) {
    return book.labs.find((l) => l.id === book.activeId) || book.labs[0];
  }

  function addLab(book, name, lab) {
    if (book.labs.length >= MAX_LABS) throw new Error("20 labs is the limit.");
    const n = sanitizeName(name, "New lab");
    if (book.labs.some((l) => l.name.toLocaleLowerCase() === n.toLocaleLowerCase())) {
      throw new Error("You already have a lab with that name.");
    }
    const item = { id: uid(), name: n, state: lab };
    book.labs.push(item);
    book.activeId = item.id;
    return item;
  }

  function renameLab(book, name) {
    const n = sanitizeName(name, "");
    if (!n) throw new Error("Lab names need 1 to 60 characters.");
    if (book.labs.some((l) => l.id !== book.activeId && l.name.toLocaleLowerCase() === n.toLocaleLowerCase())) {
      throw new Error("You already have a lab with that name.");
    }
    activeLab(book).name = n;
  }

  function removeLab(book, emptyLab) {
    book.labs = book.labs.filter((l) => l.id !== book.activeId);
    if (!book.labs.length) {
      const next = createBook(emptyLab, "New lab");
      book.activeId = next.activeId;
      book.labs = next.labs;
    } else {
      book.activeId = book.labs[0].id;
    }
  }

  function canAddAnotherLab(hasPro, book) {
    return hasPro || !book || book.labs.length < 1;
  }

  function b64url(bytes) {
    let str = "";
    bytes.forEach((b) => {
      str += String.fromCharCode(b);
    });
    const btoaFn = typeof btoa === "function" ? btoa : (s) => Buffer.from(s, "binary").toString("base64");
    return btoaFn(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64url(text) {
    const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
    const atobFn = typeof atob === "function" ? atob : (s) => Buffer.from(s, "base64").toString("binary");
    const bin = atobFn(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gzipBytes(bytes) {
    if (typeof CompressionStream !== "undefined") {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    try {
      const zlib = require("node:zlib");
      return zlib.gzipSync(Buffer.from(bytes));
    } catch {
      return null;
    }
  }

  async function gunzipBytes(bytes) {
    if (typeof DecompressionStream !== "undefined") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const zlib = require("node:zlib");
    return zlib.gunzipSync(Buffer.from(bytes));
  }

  function textFromBytes(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function compactLab(lab, name) {
    const circuit = defaultCircuit(lab);
    const hosts = ((lab && lab.hosts) || []).slice(0, MAX_HOSTS).map((h) => ({
      id: String(h.id || ""),
      name: String(h.name || "").slice(0, 80),
      type: h.type,
      ip: h.ip || "",
      mac: h.mac || "",
      vlan: h.vlan || "",
      vmid: h.vmid || "",
      parentId: h.parentId || "",
      notes: String(h.notes || "").slice(0, 500),
      idleWatts: h.idleWatts,
      loadWatts: h.loadWatts,
      loadPct: h.loadPct,
      hours: h.hours,
      powerPartId: h.powerPartId || "",
      backupLocation: h.backupLocation || "",
      lastUpdated: h.lastUpdated || "",
      warrantyDate: h.warrantyDate || "",
      services: (h.services || []).slice(0, 20).map((s) => ({
        id: s.id,
        name: s.name,
        port: s.port,
        url: s.url,
        notes: s.notes
      }))
    }));
    return {
      v: 1,
      n: sanitizeName(name || (lab && lab.name), "Shared lab"),
      e: { voltageMode: circuit.voltageMode, voltage: circuit.voltage, breaker: circuit.breaker },
      h: hosts
    };
  }

  function expandLab(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.h)) throw new Error("This link is not a lab notebook.");
    if (raw.h.length > MAX_HOSTS) throw new Error("That link has too many hosts.");
    return {
      version: 1,
      name: sanitizeName(raw.n, "Shared lab"),
      updatedAt: new Date().toISOString(),
      voltageMode: raw.e && raw.e.voltageMode,
      voltage: raw.e && raw.e.voltage,
      breaker: raw.e && raw.e.breaker,
      hosts: raw.h
    };
  }

  async function encodeToken(obj, prefix) {
    const json = JSON.stringify(obj);
    const plain = new TextEncoder().encode(json);
    let tag = "j.";
    let bytes = plain;
    if (plain.length > 60) {
      const zipped = await gzipBytes(plain);
      if (zipped && zipped.length + 2 < plain.length) {
        tag = "z.";
        bytes = zipped;
      }
    }
    const token = tag + b64url(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (token.length > MAX_HASH) throw new Error("That lab is too large to fit in a link.");
    return prefix + token;
  }

  async function decodeToken(text, prefix) {
    let raw = String(text || "").trim();
    try {
      if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hash || raw;
    } catch { /* plain token */ }
    raw = raw.replace(/^#/, "");
    if (prefix && raw.startsWith(prefix)) raw = raw.slice(prefix.length);
    if (raw.length > MAX_HASH) throw new Error("That link is too long.");
    if (!/^[jz]\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error("That link is not a lab notebook.");
    let bytes = fromB64url(raw.slice(2));
    if (raw.startsWith("z.")) bytes = await gunzipBytes(bytes);
    try {
      return JSON.parse(textFromBytes(bytes));
    } catch {
      throw new Error("That link is damaged.");
    }
  }

  async function encodeShare(lab, name) {
    return encodeToken(compactLab(lab, name), "n=");
  }

  async function decodeShare(text) {
    return expandLab(await decodeToken(text, "n="));
  }

  function powerDeviceId(host, index) {
    const raw = String((host && (host.id || host.name)) || "d" + index).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
    return raw || "d" + index;
  }

  function toPowerState(lab) {
    const circuit = defaultCircuit(lab);
    const devices = [];
    ((lab && lab.hosts) || []).forEach((host, i) => {
      if (!isWallHost(host) && wattsOf(host) == null) return;
      const suggested = suggestWatts(host.type, host.powerPartId, null);
      const w = wattsOf(host) || (suggested ? { idle: suggested.idle, load: suggested.load, loadPct: 20, hours: 24 } : null);
      if (!w) return;
      if (!isWallHost(host)) return;
      devices.push({
        id: powerDeviceId(host, i),
        name: String(host.name || "Device").slice(0, 100),
        idle: w.idle,
        load: w.load,
        loadPct: w.loadPct,
        hours: w.hours,
        start: 0,
        selected: true
      });
    });
    if (devices.length > MAX_DEVICES) devices.length = MAX_DEVICES;
    return {
      version: 1,
      region: null,
      currency: "USD",
      rate: 0.2,
      tou: false,
      offRate: 0.15,
      peakRate: 0.35,
      peakStart: 16,
      peakEnd: 21,
      offStart: 0,
      offEnd: 7,
      periods: [],
      consolidateWatts: 55,
      replacementWatts: 25,
      price: 350,
      voltageMode: circuit.voltageMode,
      voltage: circuit.voltage,
      breaker: circuit.breaker,
      devices
    };
  }

  function encodePowerSShare(state) {
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    return "s=" + b64url(bytes);
  }

  function decodePowerSShare(text) {
    let raw = String(text || "").trim();
    try {
      if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hash || raw;
    } catch { /* token */ }
    raw = raw.replace(/^#/, "");
    if (raw.startsWith("s=")) raw = raw.slice(2);
    if (raw.length > MAX_HASH) throw new Error("That link is too long.");
    const json = textFromBytes(fromB64url(raw));
    const data = JSON.parse(json);
    if (!data || data.version !== 1 || !Array.isArray(data.devices)) throw new Error("This link is not a Homelab Power calculator share.");
    if (data.devices.length > MAX_DEVICES) throw new Error("That link has too many devices.");
    return data;
  }

  function toInterop(lab, name, source) {
    const circuit = defaultCircuit(lab);
    const devices = [];
    ((lab && lab.hosts) || []).forEach((host) => {
      const w = wattsOf(host);
      const qty = 1;
      devices.push({
        id: String(host.id || ""),
        name: String(host.name || "").slice(0, 100),
        type: host.type || "other",
        partId: host.powerPartId || "",
        idleW: w ? w.idle : undefined,
        typicalW: w ? w.load : undefined,
        qty,
        ip: host.ip || undefined,
        mac: host.mac || undefined
      });
    });
    if (devices.length > MAX_DEVICES) devices.length = MAX_DEVICES;
    return {
      v: 1,
      source: source || "homelab-notebook",
      name: sanitizeName(name || (lab && lab.name), "Shared lab"),
      voltageMode: circuit.voltageMode,
      voltage: circuit.voltage,
      breaker: circuit.breaker,
      devices
    };
  }

  function typeFromPart(part) {
    if (!part) return "other";
    return CATEGORY_TYPE[part.category] || "other";
  }

  function hostsFromInterop(payload, parts) {
    if (!payload || payload.v !== 1 || !Array.isArray(payload.devices)) {
      throw new Error("This is not a Homelab Power interchange file.");
    }
    if (payload.devices.length > MAX_DEVICES) throw new Error("That link has too many devices.");
    const hosts = [];
    payload.devices.forEach((d, i) => {
      const qty = Math.max(1, Math.min(99, Math.round(finite(d.qty) || 1)));
      const part = partById(parts, d.partId);
      const type = d.type && String(d.type) ? String(d.type) : typeFromPart(part);
      const idle = clampNum(d.idleW, 0, 100000) ?? (part ? finite(part.idleW) : null);
      const load = clampNum(d.typicalW, 0, 100000) ?? (part ? finite(part.typicalW) ?? finite(part.maxW) : null);
      for (let q = 0; q < qty; q++) {
        const suffix = qty > 1 ? " " + (q + 1) : "";
        hosts.push({
          id: uid(),
          powerId: String(d.id || "") + (qty > 1 ? "-" + (q + 1) : ""),
          name: String(d.name || part && ((part.brand || "") + " " + (part.model || "")).trim() || "Device").slice(0, 80) + suffix,
          type: type === "vm" || type === "lxc" || TYPE_WATTS[type] || type === "other" ? type : typeFromPart(part),
          ip: d.ip || "",
          mac: d.mac || "",
          vlan: "",
          vmid: "",
          parentId: "",
          notes: "",
          idleWatts: idle,
          loadWatts: load,
          loadPct: 20,
          hours: 24,
          powerPartId: d.partId || (part && part.id) || "",
          backupLocation: "",
          lastUpdated: "",
          warrantyDate: "",
          services: []
        });
      }
    });
    return {
      version: 1,
      name: sanitizeName(payload.name, "Imported lab"),
      updatedAt: new Date().toISOString(),
      voltageMode: payload.voltageMode,
      voltage: payload.voltage,
      breaker: payload.breaker,
      hosts
    };
  }

  function hostsFromPowerState(state) {
    if (!state || !Array.isArray(state.devices)) throw new Error("This link is not a Homelab Power calculator share.");
    const hosts = state.devices.slice(0, MAX_DEVICES).map((d) => ({
      id: uid(),
      powerId: String(d.id || ""),
      name: String(d.name || "Device").slice(0, 80),
      type: guessTypeFromName(d.name),
      ip: "",
      mac: "",
      vlan: "",
      vmid: "",
      parentId: "",
      notes: "",
      idleWatts: clampNum(d.idle, 0, 100000),
      loadWatts: clampNum(d.load, 0, 100000),
      loadPct: clampNum(d.loadPct, 0, 100) ?? 20,
      hours: clampNum(d.hours, 0, 24) ?? 24,
      powerPartId: "",
      backupLocation: "",
      lastUpdated: "",
      warrantyDate: "",
      services: []
    }));
    return {
      version: 1,
      name: "Imported from Homelab Power",
      updatedAt: new Date().toISOString(),
      voltageMode: state.voltageMode,
      voltage: state.voltage,
      breaker: state.breaker,
      hosts
    };
  }

  function guessTypeFromName(name) {
    const n = String(name || "").toLowerCase();
    if (/\bpi[- ]?hole\b|\brasberry|\b raspi\b|\bpi [345]\b/.test(n) || n.includes("raspberry")) return "pi";
    if (/\bnas\b|truenas|unraid|synology|qnap/.test(n)) return "nas";
    if (/\bswitch\b|usw-/.test(n)) return "switch";
    if (/\bfirewall\b|opnsense|pfsense/.test(n)) return "firewall";
    if (/\brouter\b|udm|unifi-gw|gateway/.test(n)) return "router";
    if (/\bproxmox\b|\bpve\b|mini pc|minipc/.test(n)) return "proxmox-node";
    return "other";
  }

  function hostsFromPowerBuild(build, parts) {
    if (!build || !Array.isArray(build.items)) throw new Error("This link is not a Homelab Power planner share.");
    const hosts = [];
    build.items.slice(0, MAX_DEVICES).forEach((item) => {
      const part = partById(parts, item.partId);
      const qty = Math.max(1, Math.min(99, Math.round(finite(item.qty) || 1)));
      const idle = clampNum(item.idleOverride, 0, 100000) ?? (part ? finite(part.idleW) : null);
      const load = clampNum(item.typicalOverride, 0, 100000) ?? (part ? finite(part.typicalW) ?? finite(part.maxW) : null);
      const type = typeFromPart(part);
      const base = part ? ((part.brand ? part.brand + " " : "") + (part.model || part.id)).trim() : item.partId || "Part";
      for (let q = 0; q < qty; q++) {
        hosts.push({
          id: uid(),
          powerId: String(item.partId || "") + (qty > 1 ? "-" + (q + 1) : ""),
          name: qty > 1 ? base + " " + (q + 1) : base,
          type,
          ip: "",
          mac: "",
          vlan: "",
          vmid: "",
          parentId: "",
          notes: "",
          idleWatts: idle,
          loadWatts: load,
          hours: 24,
          loadPct: 20,
          powerPartId: item.partId || "",
          backupLocation: "",
          lastUpdated: "",
          warrantyDate: "",
          services: []
        });
      }
    });
    return {
      version: 1,
      name: sanitizeName(build.name, "Imported build"),
      updatedAt: new Date().toISOString(),
      hosts
    };
  }

  function compactPlanner(raw) {
    return raw;
  }

  async function decodePowerBShare(text) {
    let raw = String(text || "").trim();
    try {
      if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hash || raw;
    } catch { /* token */ }
    raw = raw.replace(/^#/, "");
    if (raw.startsWith("b=")) raw = raw.slice(2);
    const data = await decodeToken(raw, "");
    if (!data || data.v !== 1 || !Array.isArray(data.i)) throw new Error("This link is not a Homelab Power planner share.");
    const items = data.i.map((row) => {
      if (!Array.isArray(row)) throw new Error("A part in that link is unreadable.");
      return {
        partId: String(row[0] || ""),
        qty: row[1] || 1,
        placement: row[2],
        startU: row[3] === "" || row[3] == null ? null : row[3],
        idleOverride: row[4] === "" || row[4] == null ? null : row[4],
        typicalOverride: row[5] === "" || row[5] == null ? null : row[5]
      };
    });
    return { name: data.n, width: data.w, heightU: data.h, items };
  }

  async function encodeInterop(payload) {
    return encodeToken(payload, "p=");
  }

  async function decodeInterop(text) {
    const data = await decodeToken(text, "p=");
    if (!data || data.v !== 1 || !Array.isArray(data.devices)) throw new Error("This is not a Homelab interchange link.");
    if (data.devices.length > MAX_DEVICES) throw new Error("That link has too many devices.");
    return data;
  }

  function hashKind(text) {
    let raw = String(text || "").trim();
    try {
      if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hash || raw;
    } catch { /* token */ }
    raw = raw.replace(/^#/, "");
    if (raw.startsWith("n=")) return "notebook";
    if (raw.startsWith("p=")) return "interop";
    if (raw.startsWith("s=")) return "power-calc";
    if (raw.startsWith("b=")) return "power-plan";
    return null;
  }

  async function parseIncomingLink(text, parts) {
    const kind = hashKind(text);
    if (!kind) throw new Error("Paste a Homelab Notebook or Homelab Power share link.");
    if (kind === "notebook") {
      const lab = await decodeShare(text);
      return { kind, source: "homelab-notebook", lab, mode: "open" };
    }
    if (kind === "interop") {
      const payload = await decodeInterop(text);
      return { kind, source: payload.source || "homelab-power", lab: hostsFromInterop(payload, parts), payload, mode: "open" };
    }
    if (kind === "power-calc") {
      const state = decodePowerSShare(text);
      return { kind, source: "homelab-power", lab: hostsFromPowerState(state), mode: "open" };
    }
    const build = await decodePowerBShare(text);
    return { kind, source: "homelab-power", lab: hostsFromPowerBuild(build, parts), mode: "open" };
  }

  function linkKey(host) {
    if (host.powerId) return "p:" + host.powerId;
    return "n:" + String(host.name || "").trim().toLowerCase() + "|" + String(host.type || "");
  }

  function mergeLabs(current, incoming) {
    const used = new Set();
    const byKey = new Map();
    (current.hosts || []).forEach((h) => {
      byKey.set(linkKey(h), h);
    });
    const hosts = (current.hosts || []).map((h) => ({ ...h, services: (h.services || []).map((s) => ({ ...s })) }));
    let updated = 0;
    let added = 0;
    for (const host of incoming.hosts || []) {
      const key = linkKey(host);
      const existing = byKey.get(key);
      if (existing && !used.has(existing.id)) {
        used.add(existing.id);
        const target = hosts.find((h) => h.id === existing.id);
        if (!target) continue;
        if (host.idleWatts != null) target.idleWatts = host.idleWatts;
        if (host.loadWatts != null) target.loadWatts = host.loadWatts;
        if (host.loadPct != null) target.loadPct = host.loadPct;
        if (host.hours != null) target.hours = host.hours;
        if (host.powerPartId) target.powerPartId = host.powerPartId;
        if (host.powerId) target.powerId = host.powerId;
        if (host.ip && !target.ip) target.ip = host.ip;
        if (host.mac && !target.mac) target.mac = host.mac;
        updated += 1;
      } else {
        const copy = { ...host, id: uid(), services: (host.services || []).map((s) => ({ ...s, id: s.id || uid() })) };
        hosts.push(copy);
        added += 1;
      }
    }
    return {
      lab: {
        ...current,
        updatedAt: new Date().toISOString(),
        hosts,
        voltageMode: current.voltageMode || incoming.voltageMode,
        voltage: current.voltage || incoming.voltage,
        breaker: current.breaker || incoming.breaker
      },
      updated,
      added
    };
  }

  function csvCell(value) {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(lab) {
    const headers = [
      "Name", "Type", "IP", "MAC", "VLAN", "VMID", "Parent",
      "Idle W", "Load W", "At load %", "Hours/day", "Part id",
      "Backup location", "Last updated", "Warranty", "Services", "Notes"
    ];
    const byId = Object.fromEntries(((lab && lab.hosts) || []).map((h) => [h.id, h]));
    const lines = [headers.join(",")];
    for (const h of (lab && lab.hosts) || []) {
      const parent = h.parentId && byId[h.parentId] ? byId[h.parentId].name : "";
      const services = (h.services || []).map((s) => s.name + (s.port ? " :" + s.port : "")).join("; ");
      lines.push([
        h.name, h.type, h.ip, h.mac, h.vlan, h.vmid, parent,
        h.idleWatts ?? "", h.loadWatts ?? "", h.loadPct ?? "", h.hours ?? "",
        h.powerPartId || "", h.backupLocation || "", h.lastUpdated || "", h.warrantyDate || "",
        services, h.notes || ""
      ].map(csvCell).join(","));
    }
    return lines.join("\n") + "\n";
  }

  function makeBackup(book, extras) {
    return {
      app: "homelab-notebook",
      version: 1,
      exportedAt: new Date().toISOString(),
      book,
      extras: extras || {}
    };
  }

  function readBackup(data) {
    if (!data || data.app !== "homelab-notebook" || typeof data !== "object") {
      throw new Error("This file isn't a Homelab Notebook backup.");
    }
    if (data.version !== 1) {
      throw new Error(Number(data.version) > 1
        ? "This backup is from a newer copy of the app. This version can't open it."
        : "This backup is from an older copy of the app. This version can't open it.");
    }
    if (!data.book) throw new Error("That backup looks damaged.");
    return data;
  }

  function host(partial) {
    return {
      id: partial.id || uid(),
      name: partial.name || "",
      type: partial.type || "other",
      ip: partial.ip || "",
      mac: partial.mac || "",
      vlan: partial.vlan || "",
      vmid: partial.vmid || "",
      parentId: partial.parentId || "",
      notes: partial.notes || "",
      idleWatts: partial.idleWatts,
      loadWatts: partial.loadWatts,
      loadPct: partial.loadPct,
      hours: partial.hours,
      powerPartId: partial.powerPartId || "",
      backupLocation: partial.backupLocation || "",
      lastUpdated: partial.lastUpdated || "",
      warrantyDate: partial.warrantyDate || "",
      services: partial.services || []
    };
  }

  function svc(name, port, url, notes) {
    return { id: uid(), name, port: port || "", url: url || "", notes: notes || "" };
  }

  function starterTemplates() {
    return [
      {
        id: "small-home",
        name: "Small home lab",
        blurb: "A router, a switch, a Proxmox node, Pi-hole, Home Assistant, Plex, and a NAS.",
        build: smallHomeLab
      },
      {
        id: "pihole",
        name: "Pi-hole edge",
        blurb: "A router and a Pi running Pi-hole for DNS.",
        build: piholeLab
      },
      {
        id: "home-assistant",
        name: "Home Assistant",
        blurb: "A Pi or small box running Home Assistant, plus the router it lives on.",
        build: homeAssistantLab
      },
      {
        id: "media",
        name: "Plex and NAS",
        blurb: "A NAS and a Plex VM or box for media.",
        build: mediaLab
      },
      {
        id: "proxmox",
        name: "Proxmox node",
        blurb: "One Proxmox host with a couple of sample guests.",
        build: proxmoxLab
      }
    ];
  }

  function smallHomeLab() {
    const ids = { gw: uid(), sw: uid(), pve: uid(), pi: uid(), nas: uid(), ha: uid(), npm: uid(), plex: uid(), dns: uid() };
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: [
        host({ id: ids.gw, name: "gateway", type: "router", ip: "192.168.1.1", mac: "24:5a:4c:11:22:01", vlan: "1", notes: "Edge router. LAN is 192.168.1.0/24.", idleWatts: 12, loadWatts: 16, powerPartId: TYPE_PARTS.router, lastUpdated: today, backupLocation: "export on the NAS", services: [svc("Admin UI", "443", "https://192.168.1.1")] }),
        host({ id: ids.sw, name: "switch-8", type: "switch", ip: "192.168.1.2", mac: "24:5a:4c:11:22:02", vlan: "1", parentId: ids.gw, notes: "Desk switch.", idleWatts: 3.6, loadWatts: 3.9, powerPartId: TYPE_PARTS.switch, lastUpdated: today, backupLocation: "config backup on the NAS" }),
        host({ id: ids.pve, name: "pve1", type: "proxmox-node", ip: "192.168.1.10", mac: "bc:24:11:00:00:0a", vlan: "1", parentId: ids.gw, notes: "Mini PC. Backups go to the NAS.", idleWatts: 8, loadWatts: 35, powerPartId: TYPE_PARTS["proxmox-node"], lastUpdated: today, backupLocation: "PBS or a share on the NAS", services: [svc("Proxmox UI", "8006", "https://192.168.1.10:8006", "SSH on 22.")] }),
        host({ id: ids.pi, name: "pi-dns", type: "pi", ip: "192.168.1.3", mac: "d8:3a:dd:10:20:30", vlan: "1", parentId: ids.gw, notes: "Primary Pi-hole. Router DHCP points here first.", idleWatts: 3, loadWatts: 8, powerPartId: TYPE_PARTS.pi, lastUpdated: today, backupLocation: "Teleporter export", services: [svc("Pi-hole", "80", "http://192.168.1.3/admin"), svc("SSH", "22", "", "")] }),
        host({ id: ids.nas, name: "nas1", type: "nas", ip: "192.168.1.20", mac: "00:11:32:aa:bb:20", vlan: "1", parentId: ids.gw, notes: "File server. Pool on mirrored disks.", idleWatts: 35, loadWatts: 57, powerPartId: TYPE_PARTS.nas, lastUpdated: today, backupLocation: "off-site copy of the config", services: [svc("Web UI", "443", "https://192.168.1.20"), svc("SMB", "445", "smb://192.168.1.20/share")] }),
        host({ id: ids.ha, name: "haos", type: "vm", ip: "192.168.1.30", mac: "bc:24:11:00:01:00", vlan: "1", parentId: ids.pve, vmid: "100", notes: "Home Assistant OS VM.", lastUpdated: today, backupLocation: "Home Assistant backup to the NAS", services: [svc("Home Assistant", "8123", "http://192.168.1.30:8123")] }),
        host({ id: ids.npm, name: "proxy", type: "lxc", ip: "192.168.1.40", mac: "bc:24:11:00:01:01", vlan: "1", parentId: ids.pve, vmid: "101", notes: "Reverse proxy. Ports 80 and 443 forwarded from the router.", lastUpdated: today, services: [svc("Admin", "81", "http://192.168.1.40:81")] }),
        host({ id: ids.plex, name: "plex", type: "vm", ip: "192.168.1.50", mac: "bc:24:11:00:01:02", vlan: "1", parentId: ids.pve, vmid: "102", notes: "Media VM. Library lives on the NAS.", lastUpdated: today, services: [svc("Plex", "32400", "http://192.168.1.50:32400/web")] }),
        host({ id: ids.dns, name: "dns-backup", type: "lxc", ip: "192.168.1.4", mac: "bc:24:11:00:01:03", vlan: "1", parentId: ids.pve, vmid: "103", notes: "Second Pi-hole.", lastUpdated: today, services: [svc("Pi-hole", "80", "http://192.168.1.4/admin")] })
      ]
    };
  }

  function piholeLab() {
    const gw = uid();
    const pi = uid();
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: [
        host({ id: gw, name: "router", type: "router", ip: "192.168.1.1", notes: "DHCP points at the Pi-hole.", idleWatts: 12, loadWatts: 16, powerPartId: TYPE_PARTS.router, lastUpdated: today, backupLocation: "router config export", services: [svc("Admin", "443", "https://192.168.1.1")] }),
        host({ id: pi, name: "pi-hole", type: "pi", ip: "192.168.1.3", parentId: gw, notes: "Network-wide DNS filtering.", idleWatts: 3, loadWatts: 8, powerPartId: TYPE_PARTS.pi, lastUpdated: today, backupLocation: "Teleporter export", services: [svc("Pi-hole", "80", "http://192.168.1.3/admin")] })
      ]
    };
  }

  function homeAssistantLab() {
    const gw = uid();
    const ha = uid();
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: [
        host({ id: gw, name: "router", type: "router", ip: "192.168.1.1", idleWatts: 12, loadWatts: 16, powerPartId: TYPE_PARTS.router, lastUpdated: today, backupLocation: "router config export" }),
        host({ id: ha, name: "home-assistant", type: "pi", ip: "192.168.1.30", parentId: gw, notes: "Home Assistant OS on a Pi or small box.", idleWatts: 3, loadWatts: 8, powerPartId: TYPE_PARTS.pi, lastUpdated: today, backupLocation: "Home Assistant backup share", services: [svc("Home Assistant", "8123", "http://192.168.1.30:8123")] })
      ]
    };
  }

  function mediaLab() {
    const nas = uid();
    const plex = uid();
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: [
        host({ id: nas, name: "nas1", type: "nas", ip: "192.168.1.20", notes: "Media library lives here.", idleWatts: 35, loadWatts: 57, powerPartId: TYPE_PARTS.nas, lastUpdated: today, backupLocation: "off-site config backup", services: [svc("Web UI", "443", "https://192.168.1.20"), svc("SMB", "445", "smb://192.168.1.20/media")] }),
        host({ id: plex, name: "plex", type: "other", ip: "192.168.1.50", notes: "Streams from the NAS.", lastUpdated: today, services: [svc("Plex", "32400", "http://192.168.1.50:32400/web")] })
      ]
    };
  }

  function proxmoxLab() {
    const pve = uid();
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: [
        host({ id: pve, name: "pve1", type: "proxmox-node", ip: "192.168.1.10", notes: "Single node.", idleWatts: 8, loadWatts: 35, powerPartId: TYPE_PARTS["proxmox-node"], lastUpdated: today, backupLocation: "PBS or a share", services: [svc("Proxmox UI", "8006", "https://192.168.1.10:8006")] }),
        host({ name: "guest-vm", type: "vm", ip: "192.168.1.30", parentId: pve, vmid: "100", lastUpdated: today, notes: "Sample VM." }),
        host({ name: "guest-lxc", type: "lxc", ip: "192.168.1.40", parentId: pve, vmid: "101", lastUpdated: today, notes: "Sample container." })
      ]
    };
  }

  return {
    MONTH_DAYS,
    STALE_DAYS,
    MAX_LABS,
    MAX_HOSTS,
    MAX_DEVICES,
    MAX_HASH,
    TYPE_PARTS,
    TYPE_WATTS,
    uid,
    finite,
    clampNum,
    isWallHost,
    isGuest,
    partById,
    suggestWatts,
    wattsOf,
    defaultCircuit,
    labPower,
    hostUptime,
    labUptime,
    sanitizeName,
    createBook,
    readBook,
    activeLab,
    addLab,
    renameLab,
    removeLab,
    canAddAnotherLab,
    compactLab,
    encodeShare,
    decodeShare,
    toPowerState,
    encodePowerSShare,
    decodePowerSShare,
    toInterop,
    encodeInterop,
    decodeInterop,
    hostsFromInterop,
    hostsFromPowerState,
    hostsFromPowerBuild,
    decodePowerBShare,
    hashKind,
    parseIncomingLink,
    linkKey,
    mergeLabs,
    toCsv,
    makeBackup,
    readBackup,
    starterTemplates,
    guessTypeFromName,
    typeFromPart,
    powerDeviceId
  };
});
