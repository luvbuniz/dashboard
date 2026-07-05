// ── Inbound sync: the agent feeds the dashboard 🤖 ─────────────────────────
// The dashboard GETs HERMES_PULL_URL (on load, every 5 minutes, and via the
// 🔄 button) and merges whatever the agent published:
//
//   {
//     "agenda":  [ { "time": "10:00 AM", "title": "💼 Job Hunt — 2hr" } ],
//     "tasks":   [ { "id": "unique-id", "track": "jobhunt", "text": "…",
//                    "badge": { "text": "TODAY", "color": "red" } } ],
//     "message": "Library books are due Thursday!"
//   }
//
// All fields optional. Tasks are deduped by their `id` — the agent can keep
// returning the same list and nothing is added twice. `track` matches a
// track id ("money", "jobhunt", "stackadoo", "kids", "realestate"), a track
// name, or its emoji; unmatched tasks land in the first track.
// The endpoint must allow CORS (Access-Control-Allow-Origin: *).
// Fails silently, like everything else network-side.

import { uid, getConfig } from "./store.js";

function matchTrack(state, key) {
  if (!key) return null;
  const k = String(key).toLowerCase().trim();
  return (
    state.tracks.find(
      (t) => t.id === k || t.name.toLowerCase() === k || t.emoji === key
    ) || null
  );
}

export async function pullFromAgent(state) {
  const config = getConfig();
  const url = config.HERMES_PULL_URL;
  if (!url) return false;

  // Optional token so the URL can be a PRIVATE GitHub repo file, e.g.
  //   https://api.github.com/repos/<owner>/<repo>/contents/dashboard.json
  // with a read-only fine-grained PAT in HERMES_PULL_TOKEN. Free private
  // storage, no web server needed — the agent just commits the file.
  const headers = { Accept: "application/json" };
  const token = config.HERMES_PULL_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (url.includes("api.github.com")) {
    headers.Accept = "application/vnd.github.raw+json";
  }

  let data;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return false;
    data = await res.json();
  } catch {
    return false;
  }
  if (!data || typeof data !== "object") return false;

  let changed = false;

  if (Array.isArray(data.agenda)) {
    state.agenda = {
      items: data.agenda.slice(0, 20).map((e) => ({
        time: String(e.time ?? ""),
        title: String(e.title ?? ""),
      })),
      fetchedAt: Date.now(),
    };
    changed = true;
  }

  if (Array.isArray(data.tasks)) {
    for (const t of data.tasks) {
      const inboxId = String(t.id ?? "").trim();
      const text = String(t.text ?? "").trim();
      if (!inboxId || !text || state.inboxSeen.includes(inboxId)) continue;
      const track = matchTrack(state, t.track) || state.tracks[0];
      const badge =
        t.badge && t.badge.text
          ? { text: String(t.badge.text), color: String(t.badge.color || "purple") }
          : { text: "FROM AGENT", color: "purple" };
      track.tasks.push({
        id: uid(),
        text,
        done: false,
        doneAt: null,
        badges: [badge],
        createdAt: Date.now(),
        lastTouched: Date.now(),
        fromAgent: inboxId,
      });
      state.inboxSeen.push(inboxId);
      changed = true;
    }
    if (state.inboxSeen.length > 500) {
      state.inboxSeen = state.inboxSeen.slice(-400);
    }
  }

  if (typeof data.message === "string" && data.message.trim()) {
    const text = data.message.trim();
    if (state.agentMessage?.text !== text) {
      state.agentMessage = { text, dismissed: false };
      changed = true;
    }
  }

  return changed;
}
