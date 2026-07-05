// ── Hermes agent webhook ───────────────────────────────────────────────────
// POSTs event JSON to HERMES_WEBHOOK_URL (from the gitignored config.js).
// Always fails silently — the dashboard must never break when the VPS is down.

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

export function sendEvent(event, payload = {}) {
  const url =
    typeof window !== "undefined" &&
    window.HERMES_CONFIG &&
    window.HERMES_CONFIG.HERMES_WEBHOOK_URL;
  if (!url || url.includes("your-vps.example.com")) return;

  const body = JSON.stringify({
    event,
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  });

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then((res) => setStatus(res.ok))
    .catch(() => setStatus(false));
}
