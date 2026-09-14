# Agent protocol — Amy's Command Center (live page)

The live dashboard is the static page at `index.html`
(`https://luvbuniz.github.io/dashboard/`). This is the contract between
the page and whatever agent is on duty (currently Elodie, Sept 2026 trial).

## Agent → dashboard: `public/feed.json`

Committed to this repo. The page pulls it on load and via the Sync button.
All fields optional:

```json
{
  "updated": "2026-09-14T08:02:31-04:00",
  "message": "one-line note shown under the quote",
  "kicker": "Monday · sub elementary",
  "heading": "Mon, Sep 14",
  "quote": "a quote that overrides the built-in rotation",
  "cite": "who said it",
  "agenda": [{ "time": "Mon 7:30", "title": "Sub — LWR Prep elementary" }],
  "done": ["task-id-1", "task-id-2"]
}
```

- `done` marks tasks checked off **remotely**. Task ids are the page's
  `data-id` values (e.g. `sun-asg`, `b-law`). Adding an id checks it off;
  removing it (after seeing a `task_checked` with `done:false`) un-checks it.
- Keep `done` to ids the agent itself manages or has seen checked off —
  never invent ids.

## Dashboard → agent: `elodie/events/YYYY-MM-DD.jsonl`

Lives in the **events repo** (default `luvbuniz/buni`, configurable per
device in the page's ⚙️ Agent link box). One JSON object per line,
appended by the page via the GitHub Contents API:

```json
{"event":"task_checked","id":"sun-asg","label":"ASG interview notes","done":true,"day":"2026-09-14","at":"2026-09-14T14:03:22.120Z"}
```

- `done:true` = Amy checked it off; `done:false` = she un-checked it.
- The agent polls new lines, reacts (log it, drop it from its own
  task lists, update `feed.json`'s `done` array), and never writes to
  files under `elodie/events/` except reading them.
- Serialized appends (read sha → PUT) avoid write races.

## Archive & quotes (page-local)

- Check-offs snapshot into a per-day archive in localStorage on day
  rollover; entries auto-delete after 30 days; each item can be restored
  to the board or deleted forever. No agent involvement needed.
- Quotes rotate every 20 minutes from a built-in pool; `feed.json`
  `quote`/`cite` overrides the rotation when set.

## Task id conventions

- `sun-*` / day-specific: hand-written daily tasks in `index.html`.
- `b-*`: standing board items (see `STANDING` set in the page script).
