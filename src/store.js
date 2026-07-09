// ── Persistence & seed data ────────────────────────────────────────────────
const KEY = "amys-command-center-v1";
// Connection settings (webhook/pull URLs, tokens) live under their OWN key,
// entered via the ⚙️ panel. Kept out of the main state so Export JSON never
// includes secrets, and out of the repo so the public site never ships them.
const CONN_KEY = "amys-cc-connection";

export function loadConn() {
  try {
    return JSON.parse(localStorage.getItem(CONN_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveConn(conn) {
  try {
    localStorage.setItem(CONN_KEY, JSON.stringify(conn));
  } catch {
    /* storage blocked */
  }
}

// Effective config: config.js file (local dev) merged with the per-device
// ⚙️ panel values — panel wins wherever it has a non-empty value.
export function getConfig() {
  const file = (typeof window !== "undefined" && window.HERMES_CONFIG) || {};
  const merged = { ...file };
  for (const [k, v] of Object.entries(loadConn())) {
    if (v) merged[k] = v;
  }
  return merged;
}

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function task(text, badges = []) {
  return {
    id: uid(),
    text,
    done: false,
    doneAt: null,
    badges,
    createdAt: Date.now(),
    lastTouched: Date.now(),
  };
}

// Union two arrays of {id,...} objects: no duplicates, and when both sides
// have the same id the `primary` side's version wins (for in-place edits).
function unionById(primary = [], secondary = [], pick) {
  const map = new Map();
  for (const item of secondary) if (item && item.id) map.set(item.id, item);
  for (const item of primary) {
    if (!item || !item.id) continue;
    const other = map.get(item.id);
    map.set(item.id, pick && other ? pick(item, other) : item);
  }
  return [...map.values()];
}

// Merge a local and remote state for cross-device sync. The append-only
// "receipt" arrays (logs, applications, events) are UNIONED so nothing is
// ever lost; everything else (tasks, frog, settings, savings…) follows
// whichever document was edited most recently (updatedAt = last-write-wins).
export function mergeState(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newer = (remote.updatedAt || 0) >= (local.updatedAt || 0) ? remote : local;
  const out = { ...newer };
  out.logs = unionById(local.logs, remote.logs);
  out.applications = unionById(
    local.applications,
    remote.applications,
    // keep whichever copy has a real title (agent may have enriched it)
    (a, b) => (a.title ? a : b.title ? b : a)
  );
  out.events = unionById(local.events, remote.events);
  out.inboxSeen = Array.from(
    new Set([...(local.inboxSeen || []), ...(remote.inboxSeen || [])])
  ).slice(-500);
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}

export function seedState() {
  const now = Date.now();
  const frogTask = task("Audio transcript job — DO TODAY", [
    { text: "TODAY", color: "red" },
  ]);

  return {
    version: 1,
    updatedAt: 0, // last local edit (ms) — drives cross-device merge; 0 = pristine seed
    tracks: [
      {
        id: "money",
        emoji: "💰",
        name: "Money Now",
        color: "#30d158",
        colorName: "green",
        note: null,
        badge: { text: "ACTIVE GIGS", color: "green" },
        rate: 0, // set your current gig's effective $/hr in the track's log panel
        tasks: [frogTask],
      },
      {
        id: "jobhunt",
        emoji: "🎯",
        name: "Job Hunt",
        color: "#ffd60a",
        colorName: "yellow",
        note: "📌 Senior AI Enablement Specialist = top priority. Micro1 reapply.",
        badge: { text: "2/DAY", color: "yellow" },
        rate: 0,
        tasks: [
          task("Apply: Senior AI Enablement Specialist", [
            { text: "TOP PRIORITY", color: "yellow" },
          ]),
          task("Micro1 reapply"),
          task("Application 1 of 2 today"),
          task("Application 2 of 2 today"),
        ],
      },
      {
        id: "stackadoo",
        emoji: "🎮",
        name: "Stackadoo",
        color: "#a78bfa",
        colorName: "purple",
        note: "📌 Momentum or it dies. Small daily touches count.",
        badge: { text: "DAILY TOUCH", color: "purple" },
        rate: 0,
        tasks: [
          task("Daily touch: app dev (even 15 min counts)"),
          task("Daily touch: marketing / posting"),
        ],
      },
      {
        id: "kids",
        emoji: "👧",
        name: "Kids",
        color: "#64d2ff",
        colorName: "blue",
        note: null,
        badge: { text: "FAMILY", color: "blue" },
        rate: 0,
        tasks: [
          task("Camps — check schedules & signups"),
          task("Library book swap"),
          task("Thursday Aldi run", [{ text: "THURS", color: "blue" }]),
          task("Tablets — charge + screen-time check"),
        ],
      },
      {
        id: "realestate",
        emoji: "🏠",
        name: "Real Estate",
        color: "#ff453a",
        colorName: "red",
        note: null,
        badge: { text: "DUE JULY", color: "red" },
        rate: 0,
        savings: {
          label: "Engineering Fee (Colorado cabin cert. of residence)",
          current: 2000,
          goal: 4000,
        },
        tasks: [
          task("Smoke Ranch taxes", [{ text: "DUE JULY", color: "red" }]),
          task("Moonmist taxes", [{ text: "DUE JULY", color: "red" }]),
          task("McLeod deed transfer (after taxes paid)"),
          task("Confirm La Sombra water/electric accounts — Brian @ K Realty"),
          task("Trash bills"),
        ],
      },
    ],
    // timer session + manual log entries
    logs: [], // {id, trackId, taskId, task, start, end, minutes, note, manual}
    // calendar: future tasks & appointments
    events: [], // {id, date "YYYY-MM-DD", time "HH:MM"|null, title, trackId|null, done, fromAgent?}
    // job hunt: applications submitted {id, title, url|null, at}
    applications: [],
    // frog of the day
    frog: { taskId: frogTask.id, trackId: "money", date: todayKey() },
    frogCelebrated: null, // date the frog-done celebration fired
    active: null, // {trackId, taskId, startedAt}
    lastActivityAt: null, // last timer start/stop, for idle detection
    countdown: null, // {label, at} — user-set countdown widget
    agenda: null, // {items:[{time,title}], fetchedAt} — pulled from the agent
    agentMessage: null, // {text, dismissed} — note from the agent
    inboxSeen: [], // agent task ids already merged (dedupe)
    settings: {
      frogDeadlineHour: 13, // procrastination alert if frog untouched by 1pm
      workStartHour: 9,
      workEndHour: 18,
      nudges: false, // browser notifications opt-in
      theme: "light", // "light" | "dark" — 🌙 button in the top bar
      pomoWork: 25, // minutes of focus per pomodoro block (adjustable in widget)
      pomoBreak: 5, // minutes of break, auto-starts when a block ends
      jobTarget: 2, // applications per day goal
    },
    alerts: {
      frogAlertDate: null, // last date the frog alert fired
      lastIdleAlertAt: null, // last idle alert timestamp
      daySummaryDate: null, // last date the end-of-day receipt was sent
    },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.tracks)) return seedState();
    // fill any fields added after first ship
    const fresh = seedState();
    state.settings = { ...fresh.settings, ...(state.settings || {}) };
    state.alerts = { ...fresh.alerts, ...(state.alerts || {}) };
    if (!Array.isArray(state.logs)) state.logs = [];
    if (!Array.isArray(state.inboxSeen)) state.inboxSeen = [];
    if (!Array.isArray(state.events)) state.events = [];
    if (!Array.isArray(state.applications)) state.applications = [];
    if (typeof state.updatedAt !== "number") state.updatedAt = Date.now();
    // sweep calendar items that are done and more than a week old
    const weekAgo = todayKey(new Date(Date.now() - 7 * 86400000));
    state.events = state.events.filter((e) => !(e.done && e.date < weekAgo));
    return state;
  } catch {
    return seedState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full/blocked — keep running in memory */
  }
}

export function exportJSON(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `amys-command-center-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseImport(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.tracks)) {
    throw new Error("That file doesn't look like a Command Center export.");
  }
  return data;
}
