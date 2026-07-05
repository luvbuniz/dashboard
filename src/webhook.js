// ── Outbound pings: Hermes agent webhook + Telegram bots ───────────────────
// Every event goes to BOTH channels (each one only if configured):
//   1. HERMES_WEBHOOK_URL        — raw JSON for the agent on the VPS
//   2. TELEGRAM_BOT_TOKEN/CHAT_ID — human-readable message via Bot API,
//      so the accountability bots see check-offs the moment they happen.
// Everything fails silently — the dashboard must never break when the VPS
// or Telegram is unreachable. The 🟢/🔴 dot reflects the last outbound ping
// on either channel.

let lastPingOk = null; // null = never pinged, true/false = last result
const listeners = [];

export function onPingStatus(fn) {
  listeners.push(fn);
}

export function getPingStatus() {
  return lastPingOk;
}

function setStatus(ok) {
  lastPingOk = ok;
  for (const fn of listeners) {
    try {
      fn(ok);
    } catch {
      /* ignore */
    }
  }
}

import { getConfig } from "./store.js";

function cfg() {
  return getConfig();
}

// Human-readable Telegram text per event
const TELEGRAM_TEXT = {
  task_started: (p) => `▶️ Amy started: ${p.task}  (${p.track})`,
  task_stopped: (p) => `⏹ Stopped: ${p.task} — ${p.minutes} min  (${p.track})`,
  task_completed: (p) =>
    p.frog
      ? `🎉🐸 FROG CONQUERED: ${p.task}  (${p.track})`
      : `✅ Checked off: ${p.task}  (${p.track})`,
  procrastination_alert: (p) =>
    p.reason === "frog_not_started"
      ? `🐸😬 The frog "${p.task}" still hasn't been started and it's past ${p.deadline_hour}:00. Somebody ask Amy what's up.`
      : `😴 ${p.minutes_idle} min without a timer during work hours. Gentle poke requested.`,
  day_summary: (p) =>
    `📊 Amy's day receipt: ${p.minutes_focused} min focused · ${p.tasks_done} tasks done · ~$${p.earnings} earned · 🔥 ${p.streak}-day streak`,
};

function sendHermes(event, payload, timestamp) {
  const url = cfg().HERMES_WEBHOOK_URL;
  if (!url || url.includes("your-vps.example.com")) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...payload, timestamp }),
    keepalive: true,
  })
    .then((res) => setStatus(res.ok))
    .catch(() => setStatus(false));
}

function sendTelegram(event, payload) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = cfg();
  if (!token || !chatId) return;
  const toText = TELEGRAM_TEXT[event];
  const text = toText ? toText(payload) : `📟 ${event}: ${JSON.stringify(payload)}`;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    keepalive: true,
  })
    .then((res) => setStatus(res.ok))
    .catch(() => setStatus(false));
}

// ── GitHub events channel (serverless webhook replacement) ────────────────
// If GITHUB_EVENTS_TOKEN is set (fine-grained PAT, Contents read-write on
// the same repo as HERMES_PULL_URL), every event is appended to
// hermes/events/YYYY-MM-DD.jsonl in that repo — one JSON object per line.
// The agent polls that file instead of needing a webhook server.

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const b64decode = (b64) => {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

// Serialize appends so bursts (stop → completed) don't race on the file sha.
let ghQueue = Promise.resolve();

function sendGitHubEvents(event, payload, timestamp) {
  const c = cfg();
  const token = c.GITHUB_EVENTS_TOKEN;
  const m = (c.HERMES_PULL_URL || "").match(
    /^(https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents)\//
  );
  if (!token || !m) return;
  const url = `${m[1]}/hermes/events/${localDay()}.jsonl`;
  const line = JSON.stringify({ event, ...payload, timestamp }) + "\n";
  ghQueue = ghQueue.then(() => appendToGitHub(url, line, token)).catch(() => {});
}

async function appendToGitHub(url, line, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  let sha;
  let existing = "";
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const meta = await res.json();
      sha = meta.sha;
      existing = b64decode(meta.content || "");
    } else if (res.status !== 404) {
      setStatus(false);
      return;
    }
  } catch {
    setStatus(false);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "dashboard events",
        content: b64encode(existing + line),
        ...(sha ? { sha } : {}),
      }),
    });
    setStatus(res.ok);
  } catch {
    setStatus(false);
  }
}

export function sendEvent(event, payload = {}) {
  const timestamp = payload.timestamp || new Date().toISOString();
  sendHermes(event, payload, timestamp);
  sendTelegram(event, payload);
  sendGitHubEvents(event, payload, timestamp);
}
