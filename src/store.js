// ── Persistence & seed data ────────────────────────────────────────────────
const KEY = "amys-command-center-v1";

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

export function seedState() {
  const now = Date.now();
  const frogTask = task("Audio transcript job — DO TODAY", [
    { text: "TODAY", color: "red" },
  ]);

  return {
    version: 1,
    tracks: [
      {
        id: "money",
        emoji: "💰",
        name: "Money Now",
        color: "#30d158",
        colorName: "green",
        note: null,
        badge: { text: "ACTIVE GIGS", color: "green" },
        rate: 135,
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
