import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const api = require("../app.js");

const { normalizeIp, findConflicts, toYaml, normalizeLab, exampleLab, descendantIds } = api;

assert.equal(normalizeIp("  192.168.1.10 "), "192.168.1.10");
assert.equal(normalizeIp("FE80::1"), "fe80::1");

const conflicts = findConflicts([
  { name: "a", ip: "192.168.1.10" },
  { name: "b", ip: "192.168.1.10" },
  { name: "c", ip: "192.168.1.11" },
  { name: "d", ip: "" }
]);
assert.equal(conflicts.length, 1);
assert.equal(conflicts[0].ip, "192.168.1.10");
assert.equal(conflicts[0].hosts.length, 2);

const lab = exampleLab();
assert.ok(lab.hosts.length >= 8);
const pve = lab.hosts.find((h) => h.name === "pve1");
const guests = lab.hosts.filter((h) => h.parentId === pve.id);
assert.ok(guests.length >= 3);
assert.ok(descendantIds(lab.hosts, pve.id).includes(guests[0].id));

const yaml = toYaml(lab);
assert.match(yaml, /name: pve1/);
assert.match(yaml, /type: proxmox-node/);
assert.match(yaml, /services:/);

const imported = normalizeLab(JSON.parse(JSON.stringify(lab)));
assert.equal(imported.hosts.length, lab.hosts.length);

const cleaned = normalizeLab({
  hosts: [{ name: "lone", type: "vm", parentId: "missing", services: [{ name: "web", port: 80 }] }]
});
assert.equal(cleaned.hosts[0].parentId, "");
assert.equal(cleaned.hosts[0].services[0].port, "80");

assert.throws(() => normalizeLab({ nope: true }), /hosts array/);

console.log("core tests passed");
