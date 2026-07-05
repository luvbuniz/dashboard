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

## Seeing it online (GitHub Pages)

Every push auto-deploys to GitHub Pages via
`.github/workflows/deploy.yml` — the live dashboard is at:

**https://luvbuniz.github.io/dashboard/**

On the phone: open that URL in Chrome → menu ⋮ → **Add to Home screen** and
it behaves like an app.

Notes:

- Data still lives in each device's localStorage — the URL is shared, the
  data isn't. Use Export/Import JSON to sync devices.
- To ship a `config.js` with the site, add a repo Actions secret named
  `DASHBOARD_CONFIG` containing the file's contents (Settings → Secrets and
  variables → Actions). ⚠️ On a public Pages site that file is
  world-readable — fine for a webhook URL you consider low-stakes, **not**
  for the Telegram bot token. Without it the dashboard works normally,
  minus outbound pings.
- GitHub Pages on a **private** repo requires a paid GitHub plan. If you
  make this repo private on the free plan, host the `dist/` build on the
  Hermes VPS instead (any static file server works; you can then also
  password-protect it and safely include config.js).

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
- **Daily quote** → picked to fit the moment (morning start, "nothing logged
  yet" nudge, mid-grind, frog-conquered victory lap, evening wind-down) and
  rotates by date. ↻ deals another if today's doesn't land.
- **🔥 Streak** → consecutive days with at least one timer session or
  check-off. Today never breaks the streak mid-day — it just isn't banked
  until something happens. Don't break the chain.

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
| `task_completed` | also carries `frog: true/false` so agents can celebrate accordingly |
| `procrastination_alert` | `{ reason: "frog_not_started", track, task, deadline_hour, timestamp }` — frog untouched by 1 PM (configurable in Settings state) |
| `procrastination_alert` | `{ reason: "idle_during_work_hours", minutes_idle, timestamp }` — no timer activity for 90+ min between 9 AM–6 PM |
| `day_summary` | `{ minutes_focused, tasks_done, earnings, streak, timestamp }` — fires once when the workday ends (6 PM), if anything was logged and the tab is open |

Webhook failures are **silent** — the dashboard never breaks when the VPS is
down. The ⚪/🟢/🔴 dot next to the title shows the last ping's status
(⚪ = nothing sent yet).

If `config.js` is missing (or still has the example URL), webhook sends are
skipped entirely.

## Telegram accountability bots 🤖

The same events can go straight to Telegram as human-readable messages
("✅ Checked off: Smoke Ranch taxes (Real Estate)"), so the agent bots see
every check-off and lock-in the moment it happens — no Hermes required for
this channel.

1. Create a bot with [@BotFather](https://t.me/BotFather) (or reuse one of
   the agent bots' tokens) → copy the token into `TELEGRAM_BOT_TOKEN` in
   `config.js`.
2. Set `TELEGRAM_CHAT_ID`:
   - your own id (message [@userinfobot](https://t.me/userinfobot)), or
   - a **group chat id** — add the bot to the group where your agent bots
     live and every ping lands where they can all react to it.
3. That's it. Sends are fail-silent and share the status dot with Hermes.

⚠️ The bot token controls the bot — it lives only in the gitignored
`config.js`, never in the repo.

## Agent in the loop 🤖 (two-way)

Outbound is the webhook/Telegram events above. **Inbound** lets the agent
put things ON the dashboard — calendar events, tasks you told it about and
forgot, or a note. No Google keys in the dashboard: the agent already has
calendar access, it just publishes a JSON snapshot the dashboard reads.

Configure it either way:

- **Hosted app (phone/laptop, no code):** tap **⚙️ Agent setup** in the
  Data widget and paste the values there. They're stored only in that
  device's browser storage — never in the repo, never in Export JSON.
- **Local dev:** set the same keys in `config.js`. The ⚙️ panel overrides
  the file wherever it has a value.

The dashboard GETs `HERMES_PULL_URL` on load, every 5 minutes, and when
you hit **🔄 Sync agent**. Expected response (every field optional):

```json
{
  "agenda": [
    { "time": "9:00 AM",  "title": "☕ Roots — Root and Seed" },
    { "time": "10:00 AM", "title": "💼 Job Hunt — 2hr session" }
  ],
  "tasks": [
    {
      "id": "reminder-2026-07-06-library",
      "track": "kids",
      "text": "Return library books before the swap",
      "badge": { "text": "FROM HERMES", "color": "blue" }
    }
  ],
  "message": "You told me Thursday is the Aldi run — list is in your email."
}
```

- `agenda` renders as a "📅 Today" card under the frog banner — the agent
  can rebuild it from Google Calendar every morning.
- `tasks` are merged into tracks and **deduped by `id`** — the agent can
  serve the same list all day and nothing duplicates. `track` matches a
  track id (`money`, `jobhunt`, `stackadoo`, `kids`, `realestate`), name,
  or emoji; unmatched tasks land in the first track. Injected tasks get a
  purple FROM AGENT pill unless a badge is provided.
- `message` shows as a dismissible 🤖 banner; a new message re-appears.

Requirements on the agent side: serve JSON over HTTPS with
`Access-Control-Allow-Origin: *` (it's read by a browser). A static file
the agent rewrites on a schedule is enough — no server logic needed.

**No web server at all?** Use a private GitHub repo as the channel
(free): the agent commits `dashboard.json` to the repo, and the dashboard
reads it through the GitHub API. Set `HERMES_PULL_URL` to
`https://api.github.com/repos/<you>/<repo>/contents/dashboard.json` and
`HERMES_PULL_TOKEN` to a fine-grained PAT scoped to that repo with
Contents **read-only**. Full setup (plus a brain-dump workflow and
Obsidian integration) is in `docs/HERMES_PROMPT.md`.

## Google Calendar & email

The dashboard is a client-side app, so it can't log into Google by itself —
the clean pattern is to let **Hermes be the bridge**, since it already has
server-side credentials and receives every dashboard event:

- **Calendar in**: Hermes exposes e.g. `GET /agenda` returning today's
  events as JSON; a dashboard widget renders them next to the tracks (and a
  calendar block like "💼 Job Hunt — 2hr" can map to a track timer).
- **Calendar out**: on `task_completed` / `day_summary`, Hermes writes a
  "what actually happened" event into a Receipts calendar.
- **Email**: Hermes turns `day_summary` into a nightly digest email, and can
  scan the inbox for things that should become tasks (tax bills, camp
  signup confirmations) and post them back.

None of that is wired up yet — it needs endpoints on the Hermes side first.
(Claude sessions connected to the Google account can also read the calendar
and email directly when asked, without any of this plumbing.)

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
  webhook.js        Hermes + Telegram event senders (fail-silent) + status dot
  quotes.js         context-aware daily quotes (morning/stuck/grind/victory/evening)
  confetti.js       zero-dependency confetti for frog completion 🎉
  styles.css        the checklist look: Space Grotesk/DM Sans, #f0ede8, dark cards
```
