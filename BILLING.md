# Google Play Billing (Homelab Notebook)

Nothing in this repo charges a card. The web build never loads the purchase UI. The Android app does, through the PlayBilling Capacitor plugin.

Product ids are namespaced so they never collide with Homelab Power.

## Products

| Product id | Kind | Price (US, before local prices) | What it does |
|---|---|---|---|
| `homelabnotebook_pro_unlock` | Non-consumable | $2.99 | Unlocks Pro on devices signed in to the same Google account. |
| `homelabnotebook_tip_small` | Consumable | $0.99 | A tip. Unlocks nothing. Can be bought again. |
| `homelabnotebook_tip_medium` | Consumable | $2.99 | A tip. Unlocks nothing. Can be bought again. |
| `homelabnotebook_tip_large` | Consumable | $4.99 | A tip. Unlocks nothing. Can be bought again. |

Prices on the buttons are the localized strings Play returns. The app does not invent a price.

## Where it shows up

- Web and the installed page: Preview Pro stays as it is. Tip buttons are not in the page.
- Android: Preview Pro is hidden. **Get Pro** and **Restore purchases** sit with the labs. A **Leave a tip** section with the three tips is only in the Android app.

## What Pro unlocks in this app

Free: one lab, inventory, diagram, cheat sheet, share links, starter templates, the uptime checklist, copy IP/MAC, open a service URL, watts fields, watts suggestions, lab totals, the 80% breaker check, and **Price it in Homelab Power** (one-way send is free).

Opening a received Power or Notebook link as a read-only view, or loading it as a new lab on the first lab slot, is free.

Pro: more than one lab, a full backup/restore file, CSV export, merging a received link into an existing lab, and re-sync of previously linked hosts.

Pro in Notebook does not require Pro in Homelab Power, and the other way around. Each app gates only its own import and re-sync. See INTEROP.md.

## Play Console

Create and activate these one-time products on the Homelab Notebook application (`io.github.heemsec.homelabnotebook`):

- `homelabnotebook_pro_unlock` (non-consumable, $2.99 US)
- `homelabnotebook_tip_small` (consumable, $0.99 US)
- `homelabnotebook_tip_medium` (consumable, $2.99 US)
- `homelabnotebook_tip_large` (consumable, $4.99 US)

The tips are consumable because the app calls `consumeAsync`. Put the Play licensing public key in `keys/play.properties` as `playLicenseKey=...` before testing tips. Without it, tip prices are omitted and tip buttons stay disabled. There is still no server.

The plugin payload matches Homelab Power (`getState`, `restore`, `purchase`, `billingUpdate`, `pendingTips`). Grant Pro only for a `PURCHASED` `homelabnotebook_pro_unlock`, then acknowledge it. Never grant Pro for a tip. Never consume Pro. Consume a verified tip so it can be bought again.
