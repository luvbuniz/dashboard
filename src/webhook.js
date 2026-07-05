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

export function sendEvent(event, payload = {}) {
  const timestamp = payload.timestamp || new Date().toISOString();
  sendHermes(event, payload, timestamp);
  sendTelegram(event, payload);
}
