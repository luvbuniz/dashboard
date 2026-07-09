// ── Cross-device state sync via the private GitHub repo ────────────────────
// Stores the WHOLE dashboard state in dashboard-state.json in the same repo
// as HERMES_PULL_URL, using the read-write GITHUB_EVENTS_TOKEN. Every device
// with the token reads and writes this one file, so laptop and phone stay in
// sync. Merge is last-write-wins on tasks/settings + union on receipt arrays
// (see mergeState in store.js). No secrets are stored — tokens live only in
// each device's own config, never in the synced state.

import { getConfig } from "./store.js";

const FILE = "dashboard-state.json";

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob((b64 || "").replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

function base() {
  const url = getConfig().HERMES_PULL_URL || "";
  const m = url.match(
    /^(https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents)\//
  );
  return m ? m[1] : null;
}
function token() {
  return getConfig().GITHUB_EVENTS_TOKEN;
}

export function cloudReason() {
  if (!base()) return "Set the pull URL (⚙️ Agent setup) to a GitHub repo first.";
  if (!token()) return "Cloud sync needs the read-WRITE events token (🗄 in ⚙️ Agent setup).";
  return null;
}
export function cloudEnabled() {
  return !cloudReason();
}

let remoteSha = null;
let lastSerialized = null; // avoid pointless commits when nothing changed

export async function pullRemote() {
  const b = base();
  const t = token();
  if (!b || !t) return null;
  const res = await fetch(`${b}/${FILE}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
    cache: "no-cache",
  });
  if (res.status === 404) {
    remoteSha = null;
    return null;
  }
  if (!res.ok) throw new Error(`pull ${res.status}`);
  const meta = await res.json();
  remoteSha = meta.sha;
  const text = b64decode(meta.content);
  lastSerialized = text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Write state; returns {ok, skipped?}. On a sha conflict (another device
// wrote first) the caller should re-pull, merge, and push again.
export async function pushRemote(state) {
  const b = base();
  const t = token();
  if (!b || !t) return { ok: false };
  const body = JSON.stringify(state, null, 2);
  if (body === lastSerialized) return { ok: true, skipped: true };
  const res = await fetch(`${b}/${FILE}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "dashboard state sync",
      content: b64encode(body),
      ...(remoteSha ? { sha: remoteSha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    return { ok: false, conflict: true }; // sha stale — caller re-merges
  }
  if (!res.ok) return { ok: false };
  const meta = await res.json();
  remoteSha = meta.content?.sha || meta.commit?.sha || remoteSha;
  lastSerialized = body;
  return { ok: true };
}
