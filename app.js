(() => {
  const STORAGE_KEY = "homelab-notebook-v1";
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
    filter: "all",
    query: "",
    tab: "inventory"
  };

  function uid() {
    return crypto.randomUUID();
  }

  function typeLabel(id) {
    return TYPE_LABEL[id] || id || "Other";
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
      host.name,
      typeLabel(host.type),
      host.type,
      host.ip,
      host.mac,
      host.vlan,
      host.vmid,
      host.notes,
      parent && parent.name,
      ...(host.services || []).flatMap((s) => [s.name, s.port, s.url, s.notes])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  }

  function matchesFilter(host, filter) {
    if (filter === "all") return true;
    if (filter === "guest") return host.type === "vm" || host.type === "lxc";
    if (filter === "other") return !["router", "proxmox-node", "vm", "lxc", "pi", "nas"].includes(host.type);
    return host.type === filter;
  }

  function emptyLab() {
    return { version: 1, updatedAt: new Date().toISOString(), hosts: [] };
  }

  function exampleLab() {
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
    return {
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
  }

  function normalizeLab(raw) {
    if (!raw || typeof raw !== "object") throw new Error("That file is not a lab notebook export.");
    const hostsIn = Array.isArray(raw.hosts) ? raw.hosts : Array.isArray(raw) ? raw : null;
    if (!hostsIn) throw new Error("The JSON needs a hosts array.");
    const hosts = hostsIn.map((h, i) => {
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
        services
      };
    });
    const ids = new Set(hosts.map((h) => h.id));
    for (const host of hosts) {
      if (host.parentId && !ids.has(host.parentId)) host.parentId = "";
      if (host.parentId === host.id) host.parentId = "";
    }
    return {
      version: 1,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      hosts
    };
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return { ...exampleLab(), _freshExample: true };
    try {
      return normalizeLab(JSON.parse(raw));
    } catch {
      return emptyLab();
    }
  }

  function persist() {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: state.hosts
    };
    state.updatedAt = payload.updatedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    renderMeta();
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
    const lines = ["version: 1", `updatedAt: ${yamlScalar(lab.updatedAt)}`, "hosts:"];
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
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
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

  function renderFilters() {
    const box = $("#filters");
    box.innerHTML = FILTERS.map(
      (f) =>
        `<button type="button" class="chip${state.filter === f.id ? " is-active" : ""}" data-filter="${f.id}">${escapeHtml(f.label)}</button>`
    ).join("");
  }

  function visibleRows() {
    const q = state.query.trim().toLowerCase();
    return walkTree(state.hosts).filter(
      ({ host }) => matchesFilter(host, state.filter) && matchesQuery(host, q, state.hosts)
    );
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
          meta.push(
            `<span><span class="k">IP</span>${escapeHtml(host.ip)}${conflict ? ' <span class="conflict-tag">duplicate</span>' : ""}</span>`
          );
        }
        if (host.mac) meta.push(`<span><span class="k">MAC</span>${escapeHtml(host.mac)}</span>`);
        if (host.vlan) meta.push(`<span><span class="k">VLAN</span>${escapeHtml(host.vlan)}</span>`);
        if (host.vmid) meta.push(`<span><span class="k">VMID</span>${escapeHtml(host.vmid)}</span>`);
        if (parent) meta.push(`<span><span class="k">Parent</span>${escapeHtml(parent.name)}</span>`);
        const svcHtml = services
          .map(
            (s) => `<div class="svc">
              <div class="svc-main">
                <div class="svc-name">${escapeHtml(s.name || "Service")}</div>
                <div>${s.port ? `<span class="svc-port">:${escapeHtml(s.port)}</span>` : ""} ${s.url ? `<a class="svc-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a>` : ""}</div>
                ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ""}
              </div>
              <div class="svc-actions">
                <button type="button" class="quiet" data-act="edit-svc" data-host="${host.id}" data-id="${s.id}">Edit</button>
                <button type="button" class="quiet danger-text" data-act="del-svc" data-host="${host.id}" data-id="${s.id}">Delete</button>
              </div>
            </div>`
          )
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
          ${host.notes ? `<p class="notes">${escapeHtml(host.notes)}</p>` : ""}
          <div class="services">
            ${svcHtml || `<p class="muted">No services yet.</p>`}
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
    const rows = [];
    for (const { host, depth } of walkTree(state.hosts)) {
      if (depth === 0) {
        rows.push(
          `<tr class="sheet-group"><td colspan="6">${escapeHtml(host.name || "Untitled")} · ${escapeHtml(typeLabel(host.type))}</td></tr>`
        );
      }
      const services = (host.services || [])
        .map((s) => `${s.name}${s.port ? " :" + s.port : ""}${s.url ? " — " + s.url : ""}`)
        .join("<br>") || "—";
      const parent = byId(state.hosts, host.parentId);
      rows.push(`<tr>
        <td>${"&nbsp;&nbsp;".repeat(depth)}${escapeHtml(host.name || "Untitled")}<div class="muted">${escapeHtml(typeLabel(host.type))}</div></td>
        <td class="mono">${escapeHtml(host.ip || "—")}</td>
        <td class="mono">${escapeHtml(host.mac || "—")}</td>
        <td>${escapeHtml(host.vlan || "—")}${host.vmid ? `<div class="muted">VMID ${escapeHtml(host.vmid)}</div>` : ""}</td>
        <td>${escapeHtml(parent ? parent.name : "—")}</td>
        <td>${services}${host.notes ? `<div class="muted">${escapeHtml(host.notes)}</div>` : ""}</td>
      </tr>`);
    }
    const conflicts = findConflicts(state.hosts);
    el.innerHTML = `
      <div class="sheet-head">
        <div>
          <h2>Homelab cheat sheet</h2>
          <p class="muted">${state.hosts.length} host${state.hosts.length === 1 ? "" : "s"}</p>
        </div>
        <div class="sheet-meta">Updated ${escapeHtml(when)}<br>Stored only in this browser</div>
      </div>
      <div class="table-scroll">
        <table class="sheet-table">
          <thead>
            <tr>
              <th>Host</th><th>IP</th><th>MAC</th><th>VLAN / ID</th><th>Parent</th><th>Services</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
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
    if (!state.updatedAt) {
      el.textContent = "";
      return;
    }
    const when = new Date(state.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    el.textContent = `${state.hosts.length} host${state.hosts.length === 1 ? "" : "s"} · last saved locally ${when}`;
  }

  function render() {
    renderConflicts();
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
    const blob = currentBlob(text, mime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function currentBlob(text, mime) {
    return new Blob([text], { type: mime });
  }

  function currentLab() {
    return { version: 1, updatedAt: state.updatedAt || new Date().toISOString(), hosts: state.hosts };
  }

  function openHostDialog(host) {
    const dlg = $("#host-dialog");
    const form = $("#host-form");
    form.reset();
    form.id.value = host?.id || "";
    $("#host-dialog-title").textContent = host ? "Edit host" : "Add host";
    fillTypeSelect($("#host-type"), host?.type || "vm");
    fillParentSelect($("#host-parent"), host?.id || "", host?.parentId || "");
    form.name.value = host?.name || "";
    form.ip.value = host?.ip || "";
    form.mac.value = host?.mac || "";
    form.vlan.value = host?.vlan || "";
    form.vmid.value = host?.vmid || "";
    form.notes.value = host?.notes || "";
    dlg.showModal();
    form.name.focus();
  }

  function openServiceDialog(hostId, service) {
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
    const existing = data.id && byId(state.hosts, data.id);
    if (existing) {
      Object.assign(existing, data, { services: existing.services });
    } else {
      state.hosts.push({ ...data, id: data.id || uid(), services: [] });
    }
    persist();
    render();
  }

  function deleteHost(id) {
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
    if (!force && state.hosts.length && !confirm("Replace the current notebook with the example lab?")) return;
    const lab = exampleLab();
    state.hosts = lab.hosts;
    persist();
    render();
    toast("Example lab loaded");
  }

  function clearData() {
    if (!confirm("Clear all hosts and services from this browser? This cannot be undone, unless you already exported a file.")) return;
    state.hosts = [];
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
      notes: form.notes.value.trim()
    };
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
    $("#add-host").addEventListener("click", () => openHostDialog(null));
    $("#quick-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.name.value.trim();
      if (!name) return;
      upsertHost({
        id: "",
        name,
        type: form.type.value,
        ip: form.ip.value.trim(),
        mac: "",
        vlan: "",
        parentId: form.parentId.value,
        vmid: "",
        notes: ""
      });
      form.reset();
      fillTypeSelect($("#quick-type"), "vm");
      fillParentSelect($("#quick-parent"), "", "");
      toast("Host added");
    });
    $("#host-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
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
    $("#print-sheet").addEventListener("click", () => {
      setTab("sheet");
      window.print();
    });
    $("#export-json").addEventListener("click", () => {
      download("homelab-notebook.json", JSON.stringify(currentLab(), null, 2), "application/json");
      toast("JSON exported");
    });
    $("#export-yaml").addEventListener("click", () => {
      download("homelab-notebook.yaml", toYaml(currentLab()), "text/yaml");
      toast("YAML exported");
    });
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const lab = normalizeLab(JSON.parse(await file.text()));
        if (state.hosts.length && !confirm("Replace the current notebook with the imported file?")) return;
        state.hosts = lab.hosts;
        persist();
        render();
        toast("Notebook imported");
      } catch (err) {
        alert(err.message || "Could not import that file.");
      }
    });
    $("#load-example").addEventListener("click", () => loadExample(false));
    $("#empty-example").addEventListener("click", () => loadExample(false));
    $("#clear-data").addEventListener("click", clearData);
  }

  function init() {
    const lab = load();
    state.hosts = lab.hosts;
    state.updatedAt = lab.updatedAt;
    if (lab._freshExample) persist();
    bind();
    render();
  }

  const api = { normalizeIp, findConflicts, toYaml, normalizeLab, exampleLab, descendantIds, walkTree };
  if (typeof window !== "undefined") window.HomelabNotebook = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") init();
})();
