# 🚀 Amy's Command Center

A personal productivity dashboard that replaces daily HTML checklists with one
persistent, clickable, multi-track command center. Five color-coded tracks,
one-tap task timers, time-log receipts, a Frog of the Day banner, and webhook
pings to a Hermes agent on a VPS.

Built with **Vite + vanilla JS**. All data lives in **localStorage** — no
backend, no accounts. Works on a Samsung S24 (Chrome) and desktop alike.

## Quick start

```bash
npm install
npm run dev        # open the printed URL (default http://localhost:5173)
```

Production build (static files in `dist/`):

```bash
npm run build
npm run preview    # serve the built app locally
```

The app ships pre-seeded with the 5 tracks and starter tasks, so it's useful
the second it opens.

## The 5 tracks

| Track | Color | What it's for |
|---|---|---|
| 💰 Money Now | green | Active gig work ($135/hr default rate) |
| 🎯 Job Hunt | yellow | Target: 2 applications/day |
| 🎮 Stackadoo | purple | App dev + marketing — momentum or it dies |
| 👧 Kids | blue | Camps, library swaps, Thursday Aldi runs, tablets |
| 🏠 Real Estate | red | July taxes, deed transfer, utilities + Engineering Fee savings bar |

## Using it

- **Tap a task** → starts its timer (only one timer runs at a time; starting a
  new one stops and logs the old one). Tap again to stop.
- **Checkbox** → marks done (strikethrough + fade). Completing the 🐸 frog
  gets you confetti.
- **🐸 button on any task** → pins it as Frog of the Day (banner up top with a
  countdown to the end of the workday). Tap 🐸 again to unpin.
- **✏️ / ↑ ↓ / ✕** → edit, reorder, delete tasks.
- **▸ Time log & manual entry** (per track) → every timer session with start,
  end, and minutes; a manual-entry form for when you forget to click; the
  track's $/hr rate for estimated earnings; ✕ deletes an entry.
- **Today's receipts** bar → total focused minutes, per-track chips, estimated
  earnings, and a done-today progress bar.
- **📊 History** → last 14 days of focused minutes.
- **🍅 Pomodoro** → 45-minute blocks with a chime.
- **⏳ Countdown** → set a label + time ("pickup" at 4:00 PM).
- **🔔 Enable nudges** → optional browser notifications for the
  procrastination triggers below.
- **Stale tasks** → untouched 2+ days get an amber glow; 4+ days turns red
  with 😬.

## Hermes webhook setup

The dashboard POSTs JSON events to your Hermes agent. The URL lives in a
gitignored local config so it never lands in the repo:

```bash
cp config.example.js config.js
# then edit config.js and set HERMES_WEBHOOK_URL to your VPS endpoint
```

Events sent (all include an ISO `timestamp`):

| Event | Payload |
|---|---|
| `task_started` | `{ track, task, timestamp }` |
| `task_stopped` | `{ track, task, minutes, timestamp }` |
| `task_completed` | `{ track, task, timestamp }` |
| `procrastination_alert` | `{ reason: "frog_not_started", track, task, deadline_hour, timestamp }` — frog untouched by 1 PM (configurable in Settings state) |
| `procrastination_alert` | `{ reason: "idle_during_work_hours", minutes_idle, timestamp }` — no timer activity for 90+ min between 9 AM–6 PM |

Webhook failures are **silent** — the dashboard never breaks when the VPS is
down. The ⚪/🟢/🔴 dot next to the title shows the last ping's status
(⚪ = nothing sent yet).

If `config.js` is missing (or still has the example URL), webhook sends are
skipped entirely.

> Deploying a production build? `config.js` is loaded at runtime from the site
> root, so copy your `config.js` into `dist/` after `npm run build`.

## Moving data between phone and laptop

Data is stored in the browser's localStorage, so each device has its own copy.
To sync:

1. On device A, tap **⬇️ Export JSON** — downloads
   `amys-command-center-YYYY-MM-DD.json`.
2. Get the file to device B (email, Drive, cable, whatever).
3. On device B, tap **⬆️ Import JSON** and pick the file. This **replaces**
   the data on that device.

**🧹 Reset** restores the original seeded tasks and wipes logs (it asks
first — export a backup if in doubt).

## Repo layout

```
index.html          app shell + Google Fonts + config.js loader
config.example.js   template for the gitignored config.js
src/
  main.js           app logic: timers, tasks, frog, alerts, rendering
  store.js          localStorage persistence, seed data, export/import
  webhook.js        Hermes event sender (fail-silent) + status dot
  confetti.js       zero-dependency confetti for frog completion 🎉
  styles.css        the checklist look: Space Grotesk/DM Sans, #f0ede8, dark cards
```
