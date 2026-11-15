(() => {
  const STORAGE_KEY = "homelab-notebook-v1";
  const BOOK_KEY = "homelab-notebook-book-v1";
  const PREVIEW_KEY = "homelab-notebook-preview-pro";
  const POWER_URL = "https://heemsec.github.io/homelab-power/";
  const NOTEBOOK_URL = "https://heemsec.github.io/homelab-notebook/";
  const Core = typeof globalThis !== "undefined" ? globalThis.NotebookCore : null;
  const Entitlement = typeof globalThis !== "undefined" ? globalThis.NotebookEntitlement : null;

  const TYPES = [
    { id: "router", label: "Router" },
    { id: "switch", label: "Switch" },
    { id: "firewall", label: "Firewall" },
    { id: "proxmox-node", label: "Proxmox node" },
    { id: "vm", label: "VM" },
    { id: "lxc", label: "LXC" },
    { id: "pi", label: "Pi" },
    { id: "nas", label: "NAS" },
    { id: "other", label: "Other" }
  ];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "router", label: "Routers" },
    { id: "proxmox-node", label: "Proxmox" },
    { id: "guest", label: "VMs / LXCs" },
    { id: "pi", label: "Pi" },
    { id: "nas", label: "NAS" },
    { id: "other", label: "Other" }
  ];

  const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));
  const ROOT_ORDER = ["router", "firewall", "switch", "proxmox-node", "nas", "pi", "other", "vm", "lxc"];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    hosts: [],
    updatedAt: null,
    voltageMode: "120",
    voltage: 120,
    breaker: 15,
    filter: "all",
    query: "",
    tab: "inventory",
    readonly: false
  };

  let book = null;
  let powerParts = [];
  let pendingIncoming = null;

  function uid() {
    return (Core && Core.uid()) || (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now());
  }

  function typeLabel(id) {
    return TYPE_LABEL[id] || id || "Other";
  }

  function hasPro() {
    return !!(Entitlement && Entitlement.hasPro());
  }

  function normalizeIp(ip) {
    return String(ip || "").trim().toLowerCase();
  }

  function findConflicts(hosts) {
    const map = new Map();
    for (const host of hosts) {
      const ip = normalizeIp(host.ip);
      if (!ip) continue;
      if (!map.has(ip)) map.set(ip, []);
      map.get(ip).push(host);
    }
    return [...map.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([ip, list]) => ({ ip, hosts: list }));
  }

  function conflictIps(hosts) {
    return new Set(findConflicts(hosts).map((c) => c.ip));
  }

  function childrenOf(hosts, parentId) {
    return hosts.filter((h) => h.parentId === parentId);
  }

  function descendantIds(hosts, id) {
    const out = [];
    for (const child of childrenOf(hosts, id)) {
      out.push(child.id, ...descendantIds(hosts, child.id));
    }
    return out;
  }

  function byId(hosts, id) {
    return hosts.find((h) => h.id === id);
  }

  function sortHosts(list) {
    return [...list].sort((a, b) => {
      const oa = ROOT_ORDER.indexOf(a.type);
      const ob = ROOT_ORDER.indexOf(b.type);
      if (oa !== ob) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    });
  }

  function walkTree(hosts) {
    const roots = sortHosts(hosts.filter((h) => !h.parentId || !byId(hosts, h.parentId)));
    const rows = [];
    const visit = (host, depth) => {
      rows.push({ host, depth });
      for (const child of sortHosts(childrenOf(hosts, host.id))) visit(child, depth + 1);
    };
    for (const root of roots) visit(root, 0);
    return rows;
  }

  function matchesQuery(host, query, hosts) {
    if (!query) return true;
    const parent = byId(hosts, host.parentId);
    const hay = [
      host.name, typeLabel(host.type), host.type, host.ip, host.mac, host.vlan, host.vmid,
      host.notes, host.backupLocation, host.powerPartId, parent && parent.name,
      ...(host.services || []).flatMap((s) => [s.name, s.port, s.url, s.notes])
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(query);
  }

  function matchesFilter(host, filter) {
    if (filter === "all") return true;
    if (filter === "guest") return host.type === "vm" || host.type === "lxc";
    if (filter === "other") return !["router", "proxmox-node", "vm", "lxc", "pi", "nas"].includes(host.type);
    return host.type === filter;
  }

  function parseNum(value) {
    if (value == null || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function emptyLab() {
    return { version: 1, updatedAt: new Date().toISOString(), voltageMode: "120", voltage: 120, breaker: 15, hosts: [] };
  }
  function exampleLab() {
    const today = new Date().toISOString().slice(0, 10);
    const ids = {
      gw: uid(),
      sw: uid(),
      pve: uid(),
      pi: uid(),
      nas: uid(),
      ha: uid(),
      npm: uid(),
      plex: uid(),
      dns: uid()
    };
    const lab = {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: [
        {
          id: ids.gw,
          name: "unifi-gw",
          type: "router",
          ip: "192.168.1.1",
          mac: "24:5a:4c:11:22:01",
          vlan: "1",
          parentId: "",
          vmid: "",
          notes: "UDM Pro. WAN on port 9. LAN is 192.168.1.0/24.",
          services: [{ id: uid(), name: "UniFi OS", port: "443", url: "https://192.168.1.1", notes: "" }]
        },
        {
          id: ids.sw,
          name: "usw-lite-8",
          type: "switch",
          ip: "192.168.1.2",
          mac: "24:5a:4c:11:22:02",
          vlan: "1",
          parentId: ids.gw,
          vmid: "",
          notes: "Desk switch under the rack shelf.",
          services: []
        },
        {
          id: ids.pve,
          name: "pve1",
          type: "proxmox-node",
          ip: "192.168.1.10",
          mac: "bc:24:11:00:00:0a",
          vlan: "1",
          parentId: ids.gw,
          vmid: "",
          notes: "Mini PC. Boot drive is the 1 TB NVMe. Backups go to the NAS.",
          services: [
            { id: uid(), name: "Proxmox UI", port: "8006", url: "https://192.168.1.10:8006", notes: "SSH on 22 as root." }
          ]
        },
        {
          id: ids.pi,
          name: "pi-dns",
          type: "pi",
          ip: "192.168.1.3",
          mac: "d8:3a:dd:10:20:30",
          vlan: "1",
          parentId: ids.gw,
          vmid: "",
          notes: "Primary Pi-hole. Router DHCP points here first.",
          services: [
            { id: uid(), name: "Pi-hole", port: "80", url: "http://192.168.1.3/admin", notes: "" },
            { id: uid(), name: "SSH", port: "22", url: "", notes: "User: pi" }
          ]
        },
        {
          id: ids.nas,
          name: "tank",
          type: "nas",
          ip: "192.168.1.20",
          mac: "00:11:32:aa:bb:20",
          vlan: "1",
          parentId: ids.gw,
          vmid: "",
          notes: "TrueNAS SCALE. Pool tank on 2 x 8 TB mirrors.",
          services: [
            { id: uid(), name: "Web UI", port: "443", url: "https://192.168.1.20", notes: "" },
            { id: uid(), name: "SMB", port: "445", url: "smb://192.168.1.20/tank", notes: "Media and backup shares." }
          ]
        },
        {
          id: ids.ha,
          name: "haos",
          type: "vm",
          ip: "192.168.1.30",
          mac: "bc:24:11:00:01:00",
          vlan: "1",
          parentId: ids.pve,
          vmid: "100",
          notes: "Home Assistant OS VM. USB Zigbee stick passed through.",
          services: [{ id: uid(), name: "Home Assistant", port: "8123", url: "http://192.168.1.30:8123", notes: "" }]
        },
        {
          id: ids.npm,
          name: "npm",
          type: "lxc",
          ip: "192.168.1.40",
          mac: "bc:24:11:00:01:01",
          vlan: "1",
          parentId: ids.pve,
          vmid: "101",
          notes: "Nginx Proxy Manager. Ports 80 and 443 forwarded from the router.",
          services: [{ id: uid(), name: "Admin", port: "81", url: "http://192.168.1.40:81", notes: "" }]
        },
        {
          id: ids.plex,
          name: "plex",
          type: "vm",
          ip: "192.168.1.50",
          mac: "bc:24:11:00:01:02",
          vlan: "1",
          parentId: ids.pve,
          vmid: "102",
          notes: "Media VM. Library lives on the NAS over NFS.",
          services: [{ id: uid(), name: "Plex", port: "32400", url: "http://192.168.1.50:32400/web", notes: "" }]
        },
        {
          id: ids.dns,
          name: "dns-backup",
          type: "lxc",
          ip: "192.168.1.4",
          mac: "bc:24:11:00:01:03",
          vlan: "1",
          parentId: ids.pve,
          vmid: "103",
          notes: "Second Pi-hole. Keep lists in sync with Gravity Sync or nebula-sync.",
          services: [{ id: uid(), name: "Pi-hole", port: "80", url: "http://192.168.1.4/admin", notes: "" }]
        }
      ]
    };
    const watts = {
      router: [12, 16, "ubiquiti-unifi-dream-machine-pro-udm-pro"],
      switch: [3.6, 3.9, "ubiquiti-usw-lite-8-poe"],
      "proxmox-node": [8, 35, "beelink-eq12-n100"],
      pi: [3, 8, "raspberry-pi-raspberry-pi-5-8gb"],
      nas: [35, 57, "diy-truenas-unraid-box-i3-4x-3-5-hdd"]
    };
    const backups = {
      router: "export on the NAS",
      "proxmox-node": "PBS or a share on the NAS",
      pi: "Teleporter export",
      nas: "off-site copy of the config",
      vm: "backup to the NAS"
    };
    for (const h of lab.hosts) {
      const w = watts[h.type];
      if (w && h.idleWatts == null) {
        h.idleWatts = w[0];
        h.loadWatts = w[1];
        h.powerPartId = w[2];
      }
      if (!h.lastUpdated) h.lastUpdated = today;
      if (!h.backupLocation && backups[h.type]) h.backupLocation = backups[h.type];
    }
    return lab;
  }

  function normalizeHost(h, i) {
    if (!h || typeof h !== "object") throw new Error(`Host ${i + 1} is invalid.`);
    const type = TYPES.some((t) => t.id === h.type) ? h.type : "other";
    const services = Array.isArray(h.services)
      ? h.services.filter(Boolean).map((s) => ({
          id: String(s.id || uid()),
          name: String(s.name || "").trim(),
          port: String(s.port || "").trim(),
          url: String(s.url || "").trim(),
          notes: String(s.notes || "").trim()
        }))
      : [];
    return {
      id: String(h.id || uid()),
      name: String(h.name || "").trim(),
      type,
      ip: String(h.ip || "").trim(),
      mac: String(h.mac || "").trim(),
      vlan: String(h.vlan || "").trim(),
      parentId: String(h.parentId || ""),
      vmid: String(h.vmid || "").trim(),
      notes: String(h.notes || "").trim(),
      idleWatts: parseNum(h.idleWatts),
      loadWatts: parseNum(h.loadWatts),
      loadPct: parseNum(h.loadPct),
      hours: parseNum(h.hours),
      powerPartId: String(h.powerPartId || ""),
      powerId: String(h.powerId || ""),
      backupLocation: String(h.backupLocation || "").trim(),
      lastUpdated: String(h.lastUpdated || "").trim(),
      warrantyDate: String(h.warrantyDate || "").trim(),
      services
    };
  }

  function normalizeLab(raw) {
    if (!raw || typeof raw !== "object") throw new Error("That file is not a lab notebook export.");
    const hostsIn = Array.isArray(raw.hosts) ? raw.hosts : Array.isArray(raw) ? raw : null;
    if (!hostsIn) throw new Error("The JSON needs a hosts array.");
    const hosts = hostsIn.map((h, i) => normalizeHost(h, i));
    const ids = new Set(hosts.map((h) => h.id));
    for (const host of hosts) {
      if (host.parentId && !ids.has(host.parentId)) host.parentId = "";
      if (host.parentId === host.id) host.parentId = "";
    }
    const voltageMode = raw.voltageMode === "230" || raw.voltageMode === "custom" || raw.voltageMode === "120" ? raw.voltageMode : "120";
    return {
      version: 1,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      voltageMode,
      voltage: parseNum(raw.voltage) ?? (voltageMode === "230" ? 230 : 120),
      breaker: parseNum(raw.breaker) ?? (voltageMode === "230" ? 16 : 15),
      hosts
    };
  }

  function applyLab(lab, opts) {
    const clean = normalizeLab(lab);
    state.hosts = clean.hosts;
    state.updatedAt = clean.updatedAt;
    state.voltageMode = clean.voltageMode;
    state.voltage = clean.voltage;
    state.breaker = clean.breaker;
    if (opts && opts.readonly) state.readonly = true;
    else if (opts && opts.readonly === false) state.readonly = false;
  }

  function currentLab() {
    return {
      version: 1,
      updatedAt: state.updatedAt || new Date().toISOString(),
      voltageMode: state.voltageMode,
      voltage: state.voltage,
      breaker: state.breaker,
      hosts: state.hosts
    };
  }

  function loadBook() {
    try {
      const rawBook = localStorage.getItem(BOOK_KEY);
      if (rawBook && Core) return { book: Core.readBook(JSON.parse(rawBook), normalizeLab), fresh: false };
    } catch { /* fall through to legacy */ }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) {
      const lab = exampleLab();
      const next = Core ? Core.createBook(lab, "My first lab") : { version: 1, activeId: "lab-1", labs: [{ id: "lab-1", name: "My first lab", state: lab }] };
      return { book: next, fresh: true };
    }
    try {
      const lab = normalizeLab(JSON.parse(raw));
      const next = Core ? Core.createBook(lab, "My first lab") : { version: 1, activeId: "lab-1", labs: [{ id: "lab-1", name: "My first lab", state: lab }] };
      return { book: next, fresh: false };
    } catch {
      const lab = emptyLab();
      const next = Core ? Core.createBook(lab, "My first lab") : { version: 1, activeId: "lab-1", labs: [{ id: "lab-1", name: "My first lab", state: lab }] };
      return { book: next, fresh: false };
    }
  }

  function persist() {
    if (state.readonly) return;
    const lab = { ...currentLab(), updatedAt: new Date().toISOString() };
    state.updatedAt = lab.updatedAt;
    if (book && Core) {
      const item = Core.activeLab(book);
      if (item) item.state = lab;
      try { localStorage.setItem(BOOK_KEY, JSON.stringify(book)); } catch {}
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lab)); } catch {}
    renderMeta();
    renderLabs();
    renderSummary();
  }

  function yamlScalar(value) {
    if (value == null) return '""';
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const s = String(value);
    if (s === "") return '""';
    if (/^(?:true|false|null|yes|no|on|off)$/i.test(s)) return JSON.stringify(s);
    if (/^[A-Za-z0-9_./:@+-]+$/.test(s)) return s;
    return JSON.stringify(s);
  }

  function toYaml(lab) {
    const lines = [
      "version: 1",
      `updatedAt: ${yamlScalar(lab.updatedAt)}`,
      `voltageMode: ${yamlScalar(lab.voltageMode || "120")}`,
      `voltage: ${yamlScalar(lab.voltage ?? 120)}`,
      `breaker: ${yamlScalar(lab.breaker ?? 15)}`,
      "hosts:"
    ];
    if (!lab.hosts.length) {
      lines.push("  []");
      return lines.join("\n") + "\n";
    }
    for (const h of lab.hosts) {
      lines.push(`  - id: ${yamlScalar(h.id)}`);
      lines.push(`    name: ${yamlScalar(h.name)}`);
      lines.push(`    type: ${yamlScalar(h.type)}`);
      lines.push(`    ip: ${yamlScalar(h.ip)}`);
      lines.push(`    mac: ${yamlScalar(h.mac)}`);
      lines.push(`    vlan: ${yamlScalar(h.vlan)}`);
      lines.push(`    parentId: ${yamlScalar(h.parentId)}`);
      lines.push(`    vmid: ${yamlScalar(h.vmid)}`);
      lines.push(`    notes: ${yamlScalar(h.notes)}`);
      if (h.idleWatts != null) lines.push(`    idleWatts: ${yamlScalar(h.idleWatts)}`);
      if (h.loadWatts != null) lines.push(`    loadWatts: ${yamlScalar(h.loadWatts)}`);
      if (h.loadPct != null) lines.push(`    loadPct: ${yamlScalar(h.loadPct)}`);
      if (h.hours != null) lines.push(`    hours: ${yamlScalar(h.hours)}`);
      if (h.powerPartId) lines.push(`    powerPartId: ${yamlScalar(h.powerPartId)}`);
      if (h.powerId) lines.push(`    powerId: ${yamlScalar(h.powerId)}`);
      if (h.backupLocation) lines.push(`    backupLocation: ${yamlScalar(h.backupLocation)}`);
      if (h.lastUpdated) lines.push(`    lastUpdated: ${yamlScalar(h.lastUpdated)}`);
      if (h.warrantyDate) lines.push(`    warrantyDate: ${yamlScalar(h.warrantyDate)}`);
      if (!h.services.length) {
        lines.push("    services: []");
      } else {
        lines.push("    services:");
        for (const s of h.services) {
          lines.push(`      - id: ${yamlScalar(s.id)}`);
          lines.push(`        name: ${yamlScalar(s.name)}`);
          lines.push(`        port: ${yamlScalar(s.port)}`);
          lines.push(`        url: ${yamlScalar(s.url)}`);
          lines.push(`        notes: ${yamlScalar(s.notes)}`);
        }
      }
    }
    return lines.join("\n") + "\n";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function needPro(what) {
    if (hasPro()) return false;
    toast(what + " is part of Pro.");
    const card = document.getElementById("proCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  function guardWrite() {
    if (state.readonly) {
      toast("This is a read-only view. Import a copy to edit it.");
      return true;
    }
    return false;
  }

  function fillTypeSelect(select, selected) {
    select.innerHTML = TYPES.map(
      (t) => `<option value="${t.id}"${t.id === selected ? " selected" : ""}>${escapeHtml(t.label)}</option>`
    ).join("");
  }

  function fillParentSelect(select, currentId, selected) {
    const blocked = new Set(currentId ? [currentId, ...descendantIds(state.hosts, currentId)] : []);
    const options = ['<option value="">No parent</option>'];
    for (const { host } of walkTree(state.hosts)) {
      if (blocked.has(host.id)) continue;
      const label = `${host.name || "Untitled"} (${typeLabel(host.type)}${host.ip ? " · " + host.ip : ""})`;
      options.push(
        `<option value="${escapeHtml(host.id)}"${host.id === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
      );
    }
    select.innerHTML = options.join("");
  }

  function fillPartSelect(select, selected, type) {
    const suggested = Core ? Core.suggestWatts(type, selected, powerParts) : null;
    const options = ['<option value="">No part</option>'];
    const seen = new Set();
    const prefer = [];
    if (suggested && suggested.partId) prefer.push(suggested.partId);
    if (selected) prefer.push(selected);
    for (const id of prefer) {
      const part = powerParts.find((p) => p.id === id);
      if (part && !seen.has(part.id)) {
        seen.add(part.id);
        const label = (part.brand ? part.brand + " " : "") + part.model;
        options.push(`<option value="${escapeHtml(part.id)}"${part.id === selected ? " selected" : ""}>${escapeHtml(label)}</option>`);
      }
    }
    const rest = powerParts.slice().sort((a, b) => String(a.brand + a.model).localeCompare(String(b.brand + b.model))).filter((p) => !seen.has(p.id));
    for (const part of rest) {
      const label = (part.brand ? part.brand + " " : "") + part.model;
      options.push(`<option value="${escapeHtml(part.id)}"${part.id === selected ? " selected" : ""}>${escapeHtml(label)}</option>`);
    }
    select.innerHTML = options.join("");
  }
  function renderFilters() {
    const box = $("#filters");
    box.innerHTML = FILTERS.map(
      (f) => `<button type="button" class="chip${state.filter === f.id ? " is-active" : ""}" data-filter="${f.id}">${escapeHtml(f.label)}</button>`
    ).join("");
  }

  function visibleRows() {
    const q = state.query.trim().toLowerCase();
    return walkTree(state.hosts).filter(
      ({ host }) => matchesFilter(host, state.filter) && matchesQuery(host, q, state.hosts)
    );
  }

  function renderLabs() {
    const select = $("#lab-select");
    if (!select || !book) return;
    const labs = book.labs || [];
    select.innerHTML = labs
      .map((l) => `<option value="${escapeHtml(l.id)}"${l.id === book.activeId ? " selected" : ""}>${escapeHtml(l.name)}</option>`)
      .join("");
  }

  function renderReadonly() {
    const banner = $("#readonly-banner");
    if (!banner) return;
    if (!state.readonly) {
      banner.hidden = true;
      banner.textContent = "";
      return;
    }
    banner.hidden = false;
    banner.innerHTML = 'This is a read-only view of a shared lab. <button type="button" class="linkish" id="readonly-import">Import a copy</button> to edit it.';
  }

  function renderSummary() {
    const el = $("#lab-summary");
    if (!el || !Core) return;
    const lab = currentLab();
    const power = Core.labPower(lab);
    const uptime = Core.labUptime(lab);
    const watts = `${power.averageTotal.toFixed(0)} W avg · ${power.peakTotal.toFixed(0)} W peak · ${power.monthKwh.toFixed(1)} kWh/mo`;
    const circuit = `${power.circuit.voltage} V / ${power.circuit.breaker} A (80% = ${power.limit.toFixed(0)} W)`;
    const over = power.over80 ? ' <span class="flag">Over 80% of the breaker</span>' : "";
    const missing = power.missing.length ? ` · ${power.missing.length} host${power.missing.length === 1 ? "" : "s"} missing watts` : "";
    const stale = uptime.stale ? ` <span class="flag">${uptime.stale} stale</span>` : "";
    el.hidden = false;
    el.innerHTML = `<span><strong>Power</strong> ${escapeHtml(watts)}${missing}</span><span><strong>Circuit</strong> ${escapeHtml(circuit)}${over} <button type="button" class="linkish" id="edit-circuit">Edit</button></span><span><strong>Uptime</strong> ${uptime.backupMissing} missing backup${stale}</span>`;
  }

  function flagPills(host) {
    if (!Core) return "";
    const u = Core.hostUptime(host);
    const pills = [];
    if (u.backupMissing) pills.push('<span class="flag-pill">No backup location</span>');
    if (u.staleUpdate) pills.push('<span class="flag-pill">Not updated in 90 days</span>');
    if (u.warrantyExpired) pills.push('<span class="flag-pill over">Warranty ended</span>');
    if (Core.isWallHost(host) && !Core.wattsOf(host)) pills.push('<span class="flag-pill">No watts</span>');
    return pills.length ? `<div class="host-flags">${pills.join("")}</div>` : "";
  }

  function renderInventory() {
    renderFilters();
    fillTypeSelect($("#quick-type"), "vm");
    fillParentSelect($("#quick-parent"), "", "");
    const rows = visibleRows();
    const empty = !state.hosts.length;
    const noHits = !empty && !rows.length;
    $("#empty-state").hidden = !empty;
    $("#no-results").hidden = !noHits;
    const list = $("#host-list");
    const dups = conflictIps(state.hosts);
    list.innerHTML = rows
      .map(({ host, depth }) => {
        const ip = normalizeIp(host.ip);
        const conflict = ip && dups.has(ip);
        const parent = byId(state.hosts, host.parentId);
        const services = host.services || [];
        const meta = [];
        if (host.ip) {
          meta.push(`<span><span class="k">IP</span><span class="mono-ip">${escapeHtml(host.ip)}</span>${conflict ? ' <span class="conflict-tag">duplicate</span>' : ""} <button type="button" class="quiet copy-btn" data-act="copy" data-copy="${encodeURIComponent(host.ip)}">Copy</button></span>`);
        }
        if (host.mac) {
          meta.push(`<span><span class="k">MAC</span><span class="mono-mac">${escapeHtml(host.mac)}</span> <button type="button" class="quiet copy-btn" data-act="copy" data-copy="${encodeURIComponent(host.mac)}">Copy</button></span>`);
        }
        if (host.vlan) meta.push(`<span><span class="k">VLAN</span>${escapeHtml(host.vlan)}</span>`);
        if (host.vmid) meta.push(`<span><span class="k">VMID</span>${escapeHtml(host.vmid)}</span>`);
        if (parent) meta.push(`<span><span class="k">Parent</span>${escapeHtml(parent.name)}</span>`);
        const watts = Core && Core.wattsOf(host);
        if (watts) meta.push(`<span><span class="k">Watts</span>${watts.idle} idle / ${watts.load} load</span>`);
        if (host.backupLocation) meta.push(`<span><span class="k">Backup</span>${escapeHtml(host.backupLocation)}</span>`);
        const svcHtml = services
          .map((s) => {
            const open = s.url ? `<button type="button" class="quiet" data-act="open-url" data-url="${encodeURIComponent(s.url)}">Open</button>` : "";
            return `<div class="svc">
              <div class="svc-main">
                <div class="svc-name">${escapeHtml(s.name || "Service")}</div>
                <div>${s.port ? `<span class="svc-port">:${escapeHtml(s.port)}</span>` : ""} ${s.url ? `<a class="svc-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a>` : ""}</div>
                ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ""}
              </div>
              <div class="svc-actions">
                ${open}
                <button type="button" class="quiet" data-act="edit-svc" data-host="${host.id}" data-id="${s.id}">Edit</button>
                <button type="button" class="quiet danger-text" data-act="del-svc" data-host="${host.id}" data-id="${s.id}">Delete</button>
              </div>
            </div>`;
          })
          .join("");
        return `<article class="host-card${depth ? " is-child" : ""}${conflict ? " is-conflict" : ""}" data-id="${host.id}" style="${depth > 1 ? `margin-left:${Math.min(depth, 3) * 12}px` : ""}">
          <div class="host-head">
            <div class="host-title">
              <span class="type-pill" data-type="${escapeHtml(host.type)}">${escapeHtml(typeLabel(host.type))}</span>
              <h3>${escapeHtml(host.name || "Untitled")}</h3>
            </div>
            <div class="host-actions">
              <button type="button" class="quiet" data-act="edit-host" data-id="${host.id}">Edit</button>
              <button type="button" class="quiet danger-text" data-act="del-host" data-id="${host.id}">Delete</button>
            </div>
          </div>
          ${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}
          ${flagPills(host)}
          ${host.notes ? `<p class="notes">${escapeHtml(host.notes)}</p>` : ""}
          <div class="services">
            ${svcHtml || '<p class="muted">No services yet.</p>'}
            <button type="button" class="quiet" data-act="add-svc" data-host="${host.id}">Add service</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderConflicts() {
    const banner = $("#conflict-banner");
    const conflicts = findConflicts(state.hosts);
    if (!conflicts.length) {
      banner.hidden = true;
      banner.textContent = "";
      return;
    }
    banner.hidden = false;
    banner.innerHTML = conflicts
      .map((c) => {
        const names = c.hosts.map((h) => escapeHtml(h.name || "Untitled")).join(", ");
        return `<strong>IP conflict:</strong> ${escapeHtml(c.ip)} is used by ${names}.`;
      })
      .join("<br>");
  }
  function layoutTree(hosts) {
    const BOX_W = 170;
    const BOX_H = 54;
    const H_GAP = 22;
    const V_GAP = 54;
    const SVC_H = 15;
    const childrenMap = new Map();
    for (const h of hosts) childrenMap.set(h.id, []);
    const roots = [];
    for (const h of hosts) {
      if (h.parentId && byId(hosts, h.parentId)) childrenMap.get(h.parentId).push(h);
      else roots.push(h);
    }
    for (const [id, kids] of childrenMap) {
      childrenMap.set(id, sortHosts(kids));
    }
    const orderedRoots = sortHosts(roots);
    const measures = new Map();
    const measure = (host) => {
      const kids = childrenMap.get(host.id) || [];
      const svc = (host.services || []).length;
      const body = BOX_H + (svc ? 6 + svc * SVC_H : 0);
      const childW = kids.length
        ? kids.reduce((sum, k) => sum + measure(k).width, 0) + H_GAP * (kids.length - 1)
        : 0;
      const m = { width: Math.max(BOX_W, childW), body };
      measures.set(host.id, m);
      return m;
    };
    for (const r of orderedRoots) measure(r);
    const positions = new Map();
    const place = (host, x, y) => {
      const m = measures.get(host.id);
      const boxX = x + (m.width - BOX_W) / 2;
      positions.set(host.id, { x: boxX, y, body: m.body, width: m.width });
      const kids = childrenMap.get(host.id) || [];
      let cx = x;
      const childY = y + m.body + V_GAP;
      for (const k of kids) {
        place(k, cx, childY);
        cx += measures.get(k.id).width + H_GAP;
      }
    };
    const totalW = orderedRoots.length
      ? orderedRoots.reduce((s, r) => s + measures.get(r.id).width, 0) + H_GAP * (orderedRoots.length - 1)
      : BOX_W;
    let rx = 0;
    for (const r of orderedRoots) {
      place(r, rx, 0);
      rx += measures.get(r.id).width + H_GAP;
    }
    let maxY = 80;
    for (const p of positions.values()) maxY = Math.max(maxY, p.y + p.body);
    return { positions, childrenMap, orderedRoots, width: totalW, height: maxY, BOX_W, BOX_H, SVC_H };
  }

  function renderDiagram() {
    const mount = $("#diagram");
    if (!state.hosts.length) {
      mount.innerHTML = `<p class="empty" style="box-shadow:none">Add a host to see a diagram.</p>`;
      return;
    }
    const PAD = 16;
    const { positions, childrenMap, width, height, BOX_W, BOX_H, SVC_H } = layoutTree(state.hosts);
    const vbW = Math.max(width + PAD * 2, 320);
    const vbH = height + PAD * 2;
    const edges = [];
    for (const host of state.hosts) {
      const kids = childrenMap.get(host.id) || [];
      const p = positions.get(host.id);
      for (const child of kids) {
        const c = positions.get(child.id);
        const x1 = p.x + BOX_W / 2 + PAD;
        const y1 = p.y + p.body + PAD;
        const x2 = c.x + BOX_W / 2 + PAD;
        const y2 = c.y + PAD;
        const mid = (y1 + y2) / 2;
        edges.push(
          `<path class="diagram-edge" d="M${x1} ${y1} C${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}" />`
        );
      }
    }
    const nodes = state.hosts
      .map((host) => {
        const p = positions.get(host.id);
        const x = p.x + PAD;
        const y = p.y + PAD;
        const svcs = (host.services || []).slice(0, 6);
        const svcText = svcs
          .map(
            (s, i) =>
              `<text x="${x + 10}" y="${y + BOX_H + 4 + i * SVC_H}" font-size="10" fill="currentColor">${escapeHtml(
                `${s.name}${s.port ? " :" + s.port : ""}`
              )}</text>`
          )
          .join("");
        const ip = host.ip ? escapeHtml(host.ip) : "no IP";
        return `<g class="diagram-node" data-id="${host.id}" role="button" tabindex="0">
          <rect x="${x}" y="${y}" width="${BOX_W}" height="${p.body}" rx="10" />
          <rect x="${x}" y="${y}" width="5" height="${p.body}" rx="2" fill="var(--type-${escapeHtml(host.type)})" stroke="none" />
          <text x="${x + 14}" y="${y + 20}" font-size="13" font-weight="700">${escapeHtml(host.name || "Untitled")}</text>
          <text x="${x + 14}" y="${y + 38}" font-size="11">${escapeHtml(typeLabel(host.type) + " · " + ip)}</text>
          ${svcText}
        </g>`;
      })
      .join("");
    mount.innerHTML = `<svg viewBox="0 0 ${vbW} ${vbH}" width="${vbW}" height="${vbH}" role="img" aria-label="Homelab network diagram">${edges.join("")}${nodes}</svg>`;
  }

  function renderSheet() {
    const el = $("#cheat-sheet");
    const when = state.updatedAt
      ? new Date(state.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "Not saved yet";
    if (!state.hosts.length) {
      el.innerHTML = `<div class="sheet-head"><div><h2>Homelab cheat sheet</h2></div></div><p>No hosts yet.</p>`;
      return;
    }
    const power = Core ? Core.labPower(currentLab()) : null;
    const rows = [];
    const cards = [];
    for (const { host, depth } of walkTree(state.hosts)) {
      if (depth === 0) {
        rows.push(`<tr class="sheet-group"><td colspan="7">${escapeHtml(host.name || "Untitled")} · ${escapeHtml(typeLabel(host.type))}</td></tr>`);
      }
      const services = (host.services || []).map((s) => `${s.name}${s.port ? " :" + s.port : ""}${s.url ? " — " + s.url : ""}`).join("<br>") || "—";
      const parent = byId(state.hosts, host.parentId);
      const w = Core && Core.wattsOf(host);
      const watts = w ? `${w.idle} / ${w.load} W` : "—";
      rows.push(`<tr>
        <td>${"&nbsp;&nbsp;".repeat(depth)}${escapeHtml(host.name || "Untitled")}<div class="muted">${escapeHtml(typeLabel(host.type))}</div></td>
        <td class="mono mono-ip">${escapeHtml(host.ip || "—")}</td>
        <td class="mono mono-mac">${escapeHtml(host.mac || "—")}</td>
        <td>${escapeHtml(host.vlan || "—")}${host.vmid ? `<div class="muted">VMID ${escapeHtml(host.vmid)}</div>` : ""}</td>
        <td>${escapeHtml(parent ? parent.name : "—")}</td>
        <td>${escapeHtml(watts)}</td>
        <td>${services}${host.notes ? `<div class="muted">${escapeHtml(host.notes)}</div>` : ""}</td>
      </tr>`);
      cards.push(`<article class="sheet-card">
        <h3>${escapeHtml(host.name || "Untitled")} <span class="type-pill" data-type="${escapeHtml(host.type)}">${escapeHtml(typeLabel(host.type))}</span></h3>
        <div class="kv">
          <div class="k">IP</div><div class="kv-value mono mono-ip">${escapeHtml(host.ip || "—")}</div>
          <div class="k">MAC</div><div class="kv-value mono mono-mac">${escapeHtml(host.mac || "—")}</div>
          <div class="k">VLAN / ID</div><div>${escapeHtml(host.vlan || "—")}${host.vmid ? " · VMID " + escapeHtml(host.vmid) : ""}</div>
          <div class="k">Parent</div><div>${escapeHtml(parent ? parent.name : "—")}</div>
          <div class="k">Watts</div><div>${escapeHtml(watts)}</div>
          <div class="k">Services</div><div>${services}</div>
          ${host.notes ? `<div class="k">Notes</div><div>${escapeHtml(host.notes)}</div>` : ""}
        </div>
      </article>`);
    }
    const conflicts = findConflicts(state.hosts);
    const powerLine = power
      ? `<p class="muted">${power.averageTotal.toFixed(0)} W average · ${power.peakTotal.toFixed(0)} W peak · ${power.monthKwh.toFixed(1)} kWh/month estimated${power.over80 ? " · over 80% of the breaker" : ""}</p>`
      : "";
    el.innerHTML = `
      <div class="sheet-head">
        <div>
          <h2>Homelab cheat sheet</h2>
          <p class="muted">${state.hosts.length} host${state.hosts.length === 1 ? "" : "s"}</p>
          ${powerLine}
        </div>
        <div class="sheet-meta">Updated ${escapeHtml(when)}<br>Stored only in this browser</div>
      </div>
      <div class="table-scroll">
        <table class="sheet-table">
          <thead>
            <tr>
              <th>Host</th><th>IP</th><th>MAC</th><th>VLAN / ID</th><th>Parent</th><th>Watts</th><th>Services</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
      <div class="sheet-cards">${cards.join("")}</div>
      ${
        conflicts.length
          ? `<p class="sheet-footnote"><strong>IP conflicts:</strong> ${conflicts
              .map((c) => `${escapeHtml(c.ip)} (${c.hosts.map((h) => escapeHtml(h.name)).join(", ")})`)
              .join("; ")}</p>`
          : ""
      }
      <p class="sheet-footnote">Keep a printed copy near the rack. The live notebook stays in this browser unless you export a file.</p>`;
  }

  function renderMeta() {
    const el = $("#saved-meta");
    if (!el) return;
    if (!state.updatedAt) {
      el.textContent = "";
      return;
    }
    const when = new Date(state.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const labName = book && Core ? Core.activeLab(book).name : "";
    el.textContent = `${labName ? labName + " · " : ""}${state.hosts.length} host${state.hosts.length === 1 ? "" : "s"} · last saved locally ${when}${state.readonly ? " · read-only" : ""}`;
  }

  function render() {
    renderLabs();
    renderReadonly();
    renderConflicts();
    renderSummary();
    renderInventory();
    renderDiagram();
    renderSheet();
    renderMeta();
  }

  function setTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === tab));
    $$(".view").forEach((view) => {
      const on = view.id === `view-${tab}`;
      view.hidden = !on;
      view.classList.toggle("is-active", on);
    });
  }

  function download(filename, text, mime) {
    if (typeof window !== "undefined" && window.NativeExportFile) {
      return window.NativeExportFile(filename, text, mime);
    }
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Could not copy");
    }
  }

  async function openExternal(url) {
    const raw = String(url || "").trim();
    if (!/^(https?|smb|ssh):/i.test(raw)) {
      toast("That URL can’t be opened from here.");
      return;
    }
    if (typeof window !== "undefined" && window.NativeOpenUrl) {
      try {
        await window.NativeOpenUrl(raw);
        return;
      } catch { /* fall through */ }
    }
    window.open(raw, "_blank", "noopener");
  }

  function suggestInto(data) {
    if (!Core) return data;
    if (data.idleWatts != null) return data;
    const s = Core.suggestWatts(data.type, data.powerPartId, powerParts);
    if (!s) return data;
    data.idleWatts = s.idle;
    data.loadWatts = s.load;
    if (!data.powerPartId) data.powerPartId = s.partId || "";
    return data;
  }
  function openHostDialog(host) {
    if (guardWrite() && !host) return;
    const dlg = $("#host-dialog");
    const form = $("#host-form");
    form.reset();
    form.id.value = host?.id || "";
    $("#host-dialog-title").textContent = host ? "Edit host" : "Add host";
    fillTypeSelect($("#host-type"), host?.type || "vm");
    fillParentSelect($("#host-parent"), host?.id || "", host?.parentId || "");
    fillPartSelect($("#host-part"), host?.powerPartId || "", host?.type || "vm");
    form.name.value = host?.name || "";
    form.ip.value = host?.ip || "";
    form.mac.value = host?.mac || "";
    form.vlan.value = host?.vlan || "";
    form.vmid.value = host?.vmid || "";
    form.notes.value = host?.notes || "";
    form.idleWatts.value = host?.idleWatts ?? "";
    form.loadWatts.value = host?.loadWatts ?? "";
    form.loadPct.value = host?.loadPct ?? "";
    form.hours.value = host?.hours ?? "";
    form.backupLocation.value = host?.backupLocation || "";
    form.lastUpdated.value = (host?.lastUpdated || "").slice(0, 10);
    form.warrantyDate.value = (host?.warrantyDate || "").slice(0, 10);
    dlg.showModal();
    form.name.focus();
  }

  function openServiceDialog(hostId, service) {
    if (guardWrite() && !service) return;
    const dlg = $("#service-dialog");
    const form = $("#service-form");
    form.reset();
    form.hostId.value = hostId;
    form.id.value = service?.id || "";
    $("#service-dialog-title").textContent = service ? "Edit service" : "Add service";
    form.name.value = service?.name || "";
    form.port.value = service?.port || "";
    form.url.value = service?.url || "";
    form.notes.value = service?.notes || "";
    dlg.showModal();
    form.name.focus();
  }

  function upsertHost(data) {
    if (guardWrite()) return;
    const existing = data.id && byId(state.hosts, data.id);
    if (existing) {
      const services = existing.services;
      const powerId = existing.powerId;
      Object.assign(existing, data, { services, powerId: data.powerId || powerId });
    } else {
      state.hosts.push({ ...data, id: data.id || uid(), services: data.services || [] });
    }
    persist();
    render();
  }

  function deleteHost(id) {
    if (guardWrite()) return;
    const host = byId(state.hosts, id);
    if (!host) return;
    const kids = childrenOf(state.hosts, id);
    const msg = kids.length
      ? `Delete ${host.name || "this host"} and leave ${kids.length} child host${kids.length === 1 ? "" : "s"} without a parent?`
      : `Delete ${host.name || "this host"} and its services?`;
    if (!confirm(msg)) return;
    for (const child of kids) child.parentId = "";
    state.hosts = state.hosts.filter((h) => h.id !== id);
    persist();
    render();
    toast("Host deleted");
  }

  function upsertService(hostId, data) {
    if (guardWrite()) return;
    const host = byId(state.hosts, hostId);
    if (!host) return;
    host.services = host.services || [];
    const existing = data.id && host.services.find((s) => s.id === data.id);
    if (existing) Object.assign(existing, data);
    else host.services.push({ ...data, id: data.id || uid() });
    persist();
    render();
  }

  function deleteService(hostId, id) {
    if (guardWrite()) return;
    const host = byId(state.hosts, hostId);
    if (!host) return;
    const svc = (host.services || []).find((s) => s.id === id);
    if (!confirm(`Delete service ${svc?.name || ""}?`)) return;
    host.services = host.services.filter((s) => s.id !== id);
    persist();
    render();
    toast("Service deleted");
  }

  function loadExample(force) {
    if (guardWrite()) return;
    if (!force && state.hosts.length && !confirm("Replace the current notebook with the example lab?")) return;
    applyLab(exampleLab(), { readonly: false });
    persist();
    render();
    toast("Example lab loaded");
  }

  function clearData() {
    if (guardWrite()) return;
    if (!confirm("Clear all hosts and services from this browser? This cannot be undone, unless you already exported a file.")) return;
    applyLab(emptyLab(), { readonly: false });
    persist();
    render();
    toast("Notebook cleared");
  }

  function readHostForm(form) {
    return {
      id: form.id.value,
      name: form.name.value.trim(),
      type: form.type.value,
      ip: form.ip.value.trim(),
      mac: form.mac.value.trim(),
      vlan: form.vlan.value.trim(),
      parentId: form.parentId.value,
      vmid: form.vmid.value.trim(),
      notes: form.notes.value.trim(),
      idleWatts: parseNum(form.idleWatts.value),
      loadWatts: parseNum(form.loadWatts.value),
      loadPct: parseNum(form.loadPct.value),
      hours: parseNum(form.hours.value),
      powerPartId: form.powerPartId.value,
      backupLocation: form.backupLocation.value.trim(),
      lastUpdated: form.lastUpdated.value,
      warrantyDate: form.warrantyDate.value
    };
  }

  function switchLab(id) {
    if (!book || !Core) return;
    if (state.readonly) {
      toast("Leave the read-only view first, or import a copy.");
      return;
    }
    const next = book.labs.find((l) => l.id === id);
    if (!next) return;
    persist();
    book.activeId = id;
    applyLab(next.state, { readonly: false });
    persist();
    render();
  }

  function addNewLab() {
    if (guardWrite()) return;
    if (book.labs.length >= 1 && needPro("More than one lab")) return;
    const name = prompt("Name this lab", "New lab");
    if (name == null) return;
    try {
      const item = Core.addLab(book, name, emptyLab());
      applyLab(item.state, { readonly: false });
      persist();
      render();
      toast("Lab added");
    } catch (err) {
      alert(err.message || "Could not add that lab.");
    }
  }

  function renameActiveLab() {
    if (guardWrite()) return;
    const current = Core.activeLab(book);
    const name = prompt("Rename this lab", current.name);
    if (name == null) return;
    try {
      Core.renameLab(book, name);
      persist();
      render();
    } catch (err) {
      alert(err.message || "Could not rename that lab.");
    }
  }

  function deleteActiveLab() {
    if (guardWrite()) return;
    const current = Core.activeLab(book);
    if (!confirm(`Delete lab “${current.name}”? Hosts in this lab are removed from this device.`)) return;
    Core.removeLab(book, emptyLab());
    applyLab(Core.activeLab(book).state, { readonly: false });
    persist();
    render();
    toast("Lab deleted");
  }

  function incomingSummary(incoming) {
    const lab = incoming.lab;
    const n = (lab.hosts || []).length;
    const src = incoming.source === "homelab-power" ? "Homelab Power" : "Homelab Notebook";
    return `${src} sent ${n} host${n === 1 ? "" : "s"}${lab.name ? " (“" + lab.name + "”)" : ""}. You can view it read-only for free. Saving it as a new lab is free if this is still your first lab. Merging into a lab you already have, or re-syncing linked hosts, is Pro.`;
  }

  function showIncoming(incoming) {
    pendingIncoming = incoming;
    $("#incoming-title").textContent = incoming.lab && incoming.lab.name ? incoming.lab.name : "Received lab";
    $("#incoming-blurb").textContent = incomingSummary(incoming);
    $("#incoming-dialog").showModal();
  }

  function adoptIncoming(lab) {
    applyLab(lab, { readonly: false });
    persist();
    render();
  }

  async function handleIncomingChoice(action) {
    const incoming = pendingIncoming;
    if (!incoming) return;
    if (action === "cancel") {
      $("#incoming-dialog").close();
      pendingIncoming = null;
      return;
    }
    if (action === "view") {
      applyLab(incoming.lab, { readonly: true });
      render();
      $("#incoming-dialog").close();
      toast("Read-only view");
      return;
    }
    if (action === "replace") {
      if (guardWrite()) return;
      if (state.hosts.length && !confirm("Replace the current lab with this received lab?")) return;
      adoptIncoming(incoming.lab);
      $("#incoming-dialog").close();
      pendingIncoming = null;
      toast("Lab loaded");
      return;
    }
    if (action === "new") {
      if (book.labs.length >= 1 && needPro("Saving as a new lab")) return;
      try {
        const item = Core.addLab(book, incoming.lab.name || "Imported lab", normalizeLab(incoming.lab));
        applyLab(item.state, { readonly: false });
        persist();
        render();
        $("#incoming-dialog").close();
        pendingIncoming = null;
        toast("Saved as a new lab");
      } catch (err) {
        alert(err.message || "Could not save that lab.");
      }
      return;
    }
    if (action === "merge") {
      if (needPro("Merging into this lab, or re-syncing linked hosts,")) return;
      if (guardWrite()) return;
      const result = Core.mergeLabs(currentLab(), incoming.lab);
      applyLab(result.lab, { readonly: false });
      persist();
      render();
      $("#incoming-dialog").close();
      pendingIncoming = null;
      toast(`Merged: ${result.updated} updated, ${result.added} added`);
    }
  }

  async function parseAndShow(text) {
    if (!Core) return;
    const incoming = await Core.parseIncomingLink(text, powerParts);
    showIncoming(incoming);
  }

  async function maybeOpenHash() {
    if (!Core || typeof location === "undefined") return;
    const hash = location.hash || "";
    if (!Core.hashKind(hash)) return;
    try {
      await parseAndShow(hash);
      history.replaceState(null, "", location.pathname + location.search);
    } catch (err) {
      toast(err.message || "Could not open that link.");
    }
  }

  async function shareCurrent() {
    if (!Core) return;
    const token = await Core.encodeShare(currentLab(), book && Core.activeLab(book).name);
    $("#share-url").value = NOTEBOOK_URL + "#" + token;
    $("#share-dialog").showModal();
  }

  async function priceInPower() {
    if (!Core) return;
    const stateOut = Core.toPowerState(currentLab());
    if (!stateOut.devices.length) {
      toast("Add idle/load watts on a host first, or pick a type with a suggestion.");
      return;
    }
    await openExternal(POWER_URL + "#" + Core.encodePowerSShare(stateOut));
  }

  function openCircuit() {
    const form = $("#circuit-form");
    form.voltageMode.value = state.voltageMode || "120";
    form.voltage.value = state.voltage ?? 120;
    form.breaker.value = state.breaker ?? 15;
    form.voltage.readOnly = form.voltageMode.value !== "custom";
    $("#circuit-dialog").showModal();
  }
  function bind() {
    $$(".tab").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
    $("#search").addEventListener("input", (e) => {
      state.query = e.target.value;
      renderInventory();
    });
    $("#filters").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      renderInventory();
    });
    $("#lab-select").addEventListener("change", (e) => switchLab(e.target.value));
    $("#lab-add").addEventListener("click", addNewLab);
    $("#lab-rename").addEventListener("click", renameActiveLab);
    $("#lab-delete").addEventListener("click", deleteActiveLab);
    $("#add-host").addEventListener("click", () => openHostDialog(null));
    $("#quick-add").addEventListener("submit", (e) => {
      e.preventDefault();
      if (guardWrite()) return;
      const form = e.target;
      const name = form.name.value.trim();
      if (!name) return;
      upsertHost(suggestInto({
        id: "", name, type: form.type.value, ip: form.ip.value.trim(),
        mac: "", vlan: "", parentId: form.parentId.value, vmid: "", notes: "",
        idleWatts: null, loadWatts: null, powerPartId: ""
      }));
      form.reset();
      fillTypeSelect($("#quick-type"), "vm");
      fillParentSelect($("#quick-parent"), "", "");
      toast("Host added");
    });
    $("#host-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "copy") copyText(decodeURIComponent(btn.dataset.copy || ""));
      if (act === "open-url") openExternal(decodeURIComponent(btn.dataset.url || ""));
      if (act === "edit-host") openHostDialog(byId(state.hosts, btn.dataset.id));
      if (act === "del-host") deleteHost(btn.dataset.id);
      if (act === "add-svc") openServiceDialog(btn.dataset.host, null);
      if (act === "edit-svc") {
        const host = byId(state.hosts, btn.dataset.host);
        const svc = host?.services.find((s) => s.id === btn.dataset.id);
        openServiceDialog(btn.dataset.host, svc);
      }
      if (act === "del-svc") deleteService(btn.dataset.host, btn.dataset.id);
    });
    document.addEventListener("click", (e) => {
      if (e.target && e.target.id === "edit-circuit") openCircuit();
      if (e.target && e.target.id === "readonly-import" && pendingIncoming) $("#incoming-dialog").showModal();
      else if (e.target && e.target.id === "readonly-import") $("#import-power-dialog").showModal();
    });
    $("#diagram").addEventListener("click", (e) => {
      const node = e.target.closest(".diagram-node");
      if (!node) return;
      setTab("inventory");
      openHostDialog(byId(state.hosts, node.dataset.id));
    });
    $("#diagram").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const node = e.target.closest(".diagram-node");
      if (!node) return;
      e.preventDefault();
      setTab("inventory");
      openHostDialog(byId(state.hosts, node.dataset.id));
    });
    $("#host-type").addEventListener("change", () => {
      const form = $("#host-form");
      fillPartSelect($("#host-part"), form.powerPartId.value, form.type.value);
      if (form.idleWatts.value || !Core) return;
      const s = Core.suggestWatts(form.type.value, form.powerPartId.value, powerParts);
      if (s) {
        form.idleWatts.value = s.idle;
        form.loadWatts.value = s.load;
        if (s.partId) form.powerPartId.value = s.partId;
      }
    });
    $("#host-part").addEventListener("change", () => {
      const form = $("#host-form");
      if (!Core) return;
      const s = Core.suggestWatts(form.type.value, form.powerPartId.value, powerParts);
      if (s) {
        form.idleWatts.value = s.idle;
        form.loadWatts.value = s.load;
      }
    });
    $("#host-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = readHostForm(e.target);
      if (!data.name) return;
      upsertHost(data);
      $("#host-dialog").close();
      toast("Host saved");
    });
    $("#host-cancel").addEventListener("click", () => $("#host-dialog").close());
    $("#service-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      upsertService(form.hostId.value, {
        id: form.id.value,
        name: form.name.value.trim(),
        port: form.port.value.trim(),
        url: form.url.value.trim(),
        notes: form.notes.value.trim()
      });
      $("#service-dialog").close();
      toast("Service saved");
    });
    $("#service-cancel").addEventListener("click", () => $("#service-dialog").close());
    $("#print-sheet").addEventListener("click", () => { setTab("sheet"); window.print(); });
    $("#export-json").addEventListener("click", () => {
      download("homelab-notebook.json", JSON.stringify(currentLab(), null, 2), "application/json");
      toast("JSON exported");
    });
    $("#export-yaml").addEventListener("click", () => {
      download("homelab-notebook.yaml", toYaml(currentLab()), "text/yaml");
      toast("YAML exported");
    });
    $("#export-csv").addEventListener("click", () => {
      if (needPro("CSV export")) return;
      download("homelab-notebook.csv", Core.toCsv(currentLab()), "text/csv");
      toast("CSV exported");
    });
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || guardWrite()) return;
      try {
        const lab = normalizeLab(JSON.parse(await file.text()));
        if (state.hosts.length && !confirm("Replace the current notebook with the imported file?")) return;
        applyLab(lab, { readonly: false });
        persist();
        render();
        toast("Notebook imported");
      } catch (err) {
        alert(err.message || "Could not import that file.");
      }
    });
    $("#backup-btn").addEventListener("click", () => {
      if (needPro("A full backup file")) return;
      persist();
      download("homelab-notebook-backup.json", JSON.stringify(Core.makeBackup(book), null, 2), "application/json");
      toast("Backup exported");
    });
    $("#restore-btn").addEventListener("click", () => {
      if (needPro("Restoring a backup")) return;
      $("#restore-file").click();
    });
    $("#restore-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || needPro("Restoring a backup")) return;
      try {
        const data = Core.readBackup(JSON.parse(await file.text()));
        book = Core.readBook(data.book, normalizeLab);
        applyLab(Core.activeLab(book).state, { readonly: false });
        persist();
        render();
        toast("Backup restored");
      } catch (err) {
        alert(err.message || "Could not restore that backup.");
      }
    });
    $("#share-link").addEventListener("click", () => shareCurrent().catch((err) => alert(err.message || "Could not build a share link.")));
    $("#share-close").addEventListener("click", () => $("#share-dialog").close());
    $("#share-copy").addEventListener("click", () => copyText($("#share-url").value));
    $("#price-in-power").addEventListener("click", () => priceInPower().catch((err) => alert(err.message || "Could not open Homelab Power.")));
    $("#import-power").addEventListener("click", () => {
      $("#import-power-text").value = "";
      $("#import-power-dialog").showModal();
    });
    $("#import-power-cancel").addEventListener("click", () => $("#import-power-dialog").close());
    $("#import-power-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await parseAndShow($("#import-power-text").value);
        $("#import-power-dialog").close();
      } catch (err) {
        alert(err.message || "Could not read that link.");
      }
    });
    $("#incoming-cancel").addEventListener("click", () => handleIncomingChoice("cancel"));
    $("#incoming-view").addEventListener("click", () => handleIncomingChoice("view"));
    $("#incoming-new").addEventListener("click", () => handleIncomingChoice("new"));
    $("#incoming-replace").addEventListener("click", () => handleIncomingChoice("replace"));
    $("#incoming-merge").addEventListener("click", () => handleIncomingChoice("merge"));
    function showStarters() {
      const list = $("#starter-list");
      const templates = Core.starterTemplates();
      list.innerHTML = templates
        .map((t) => `<button type="button" class="starter-item" data-starter="${t.id}"><strong>${escapeHtml(t.name)}</strong><span class="help">${escapeHtml(t.blurb)}</span></button>`)
        .join("");
      $("#starters-dialog").showModal();
    }
    $("#open-starters").addEventListener("click", showStarters);
    $("#empty-starters").addEventListener("click", showStarters);
    $("#starters-cancel").addEventListener("click", () => $("#starters-dialog").close());
    $("#starter-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-starter]");
      if (!btn || guardWrite()) return;
      const t = Core.starterTemplates().find((x) => x.id === btn.dataset.starter);
      if (!t) return;
      if (state.hosts.length && !confirm(`Replace the current lab with “${t.name}”?`)) return;
      applyLab(t.build(), { readonly: false });
      persist();
      render();
      $("#starters-dialog").close();
      toast(`${t.name} loaded`);
    });
    $("#circuit-cancel").addEventListener("click", () => $("#circuit-dialog").close());
    $("#circuit-mode").addEventListener("change", () => {
      const form = $("#circuit-form");
      form.voltage.readOnly = form.voltageMode.value !== "custom";
      if (form.voltageMode.value === "120") form.voltage.value = 120;
      if (form.voltageMode.value === "230") form.voltage.value = 230;
    });
    $("#circuit-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (guardWrite()) return;
      const form = e.target;
      state.voltageMode = form.voltageMode.value;
      state.voltage = parseNum(form.voltage.value) ?? (state.voltageMode === "230" ? 230 : 120);
      state.breaker = parseNum(form.breaker.value) ?? (state.voltageMode === "230" ? 16 : 15);
      persist();
      render();
      $("#circuit-dialog").close();
      toast("Circuit saved");
    });
    $("#load-example").addEventListener("click", () => loadExample(false));
    $("#empty-example").addEventListener("click", () => loadExample(false));
    $("#clear-data").addEventListener("click", clearData);
    const preview = $("#previewPro");
    if (preview && Entitlement) {
      preview.checked = Entitlement.isPreview();
      preview.addEventListener("change", () => {
        Entitlement.setPreview(preview.checked);
        try { localStorage.setItem(PREVIEW_KEY, String(preview.checked)); } catch {}
        render();
      });
    }
    window.addEventListener("notebook:entitlement", render);
    window.addEventListener("notebook:pro", render);
  }

  async function loadParts() {
    try {
      const res = await fetch("data/power-parts.json");
      if (res.ok) powerParts = await res.json();
    } catch {
      powerParts = [];
    }
  }

  async function init() {
    if (Entitlement && !Entitlement.usesStore()) {
      try { Entitlement.setPreview(localStorage.getItem(PREVIEW_KEY) === "true"); } catch {}
    }
    const loaded = loadBook();
    book = loaded.book;
    applyLab(Core ? Core.activeLab(book).state : book.labs[0].state, { readonly: false });
    if (loaded.fresh) persist();
    bind();
    render();
    await loadParts();
    render();
    await maybeOpenHash();
  }

  const api = { normalizeIp, findConflicts, toYaml, normalizeLab, exampleLab, descendantIds, walkTree, toast };
  if (typeof window !== "undefined") window.HomelabNotebook = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") init();
})();
