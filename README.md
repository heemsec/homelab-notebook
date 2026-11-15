# Homelab Notebook

A lightweight notebook for a small homelab: hosts, IPs, VLANs, parent machines, and the services that run on them. It builds a printable cheat sheet and a simple network diagram. NetBox and phpIPAM are more than most Proxmox labs need; this stays in the browser.

Your data never leaves the device. There is no account and no backend. Everything is saved in `localStorage`, and you can export or import a JSON file (YAML export is included too).

## Use it

Open https://heemsec.github.io/homelab-notebook/ or open `index.html` in a browser. First-time visitors get a sample lab so the screens are not empty. Use **Clear data** when you want to start from your own gear, and **Load example data** to put the sample lab back.

The look matches Homelab Power: the same navy and sky palette, system fonts, and light/dark modes.

## Hosting and app packaging

GitHub Pages serves the site from the repository root, the same way Homelab Power is hosted. The site is a PWA (`manifest.webmanifest`, icons, and a service worker) so it can be installed or packed as a Trusted Web Activity. Scope and start URL are `/homelab-notebook/`.

Digital Asset Links for Play Store verification can be added later at `.well-known/assetlinks.json` once the app signing certificate is known. Homelab Power does not publish that file on its Pages site either.
