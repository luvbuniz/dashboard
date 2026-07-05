import "./styles.css";
import {
  load,
  save,
  uid,
  todayKey,
  exportJSON,
  parseImport,
  seedState,
} from "./store.js";
import { sendEvent, onPingStatus } from "./webhook.js";
import { confettiBurst } from "./confetti.js";

// ── Runtime state ──────────────────────────────────────────────────────────
let state = load();
const sessionStart = Date.now();
const openLogs = new Set(); // track ids with the log panel expanded
let editingTaskId = null;

const pomo = {
  total: 45 * 60, // 45-minute blocks
  remaining: 45 * 60,
  running: false,
  endAt: null,
  chimed: false,
};

// ── Small helpers ──────────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const findTrack = (trackId) => state.tracks.find((t) => t.id === trackId);
const findTask = (track, taskId) => track?.tasks.find((t) => t.id === taskId);

function dayStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

const fmtMins = (m) => {
  const mins = Math.round(m);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
};

const fmtMoney = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const fmtElapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

function commit() {
  save(state);
  render();
}

function notify(title, body) {
  if (!state.settings.nudges) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: undefined });
  } catch {
    /* some mobile browsers require service workers — skip */
  }
}

// ── Derived data ───────────────────────────────────────────────────────────
function logsForDay(ts = Date.now()) {
  const start = dayStart(new Date(ts));
  const end = start + 86400000;
  return state.logs.filter((l) => l.end >= start && l.end < end);
}

function todayTotals() {
  const logs = logsForDay();
  const perTrack = {};
  let total = 0;
  let earnings = 0;
  for (const l of logs) {
    perTrack[l.trackId] = (perTrack[l.trackId] || 0) + l.minutes;
    total += l.minutes;
    const rate = findTrack(l.trackId)?.rate || 0;
    earnings += (l.minutes / 60) * rate;
  }
  return { total, perTrack, earnings };
}

function frogInfo() {
  if (!state.frog?.taskId) return null;
  const track = findTrack(state.frog.trackId);
  const task = findTask(track, state.frog.taskId);
  if (!track || !task) return null;
  const startOfToday = dayStart();
  const startedToday =
    (state.active && state.active.taskId === task.id) ||
    state.logs.some((l) => l.taskId === task.id && l.start >= startOfToday);
  return { track, task, startedToday };
}

function frogCountdownText() {
  const end = new Date();
  end.setHours(state.settings.workEndHour, 0, 0, 0);
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return "workday over — it'll still be there tomorrow 😅";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m left in the workday`;
}

// ── Timer engine ───────────────────────────────────────────────────────────
function startTimer(trackId, taskId) {
  if (state.active) stopTimer(); // one active task at a time
  const track = findTrack(trackId);
  const task = findTask(track, taskId);
  if (!track || !task || task.done) return;
  state.active = { trackId, taskId, startedAt: Date.now() };
  state.lastActivityAt = Date.now();
  task.lastTouched = Date.now();
  sendEvent("task_started", { track: track.name, task: task.text });
  commit();
}

function stopTimer() {
  const a = state.active;
  if (!a) return;
  const track = findTrack(a.trackId);
  const task = findTask(track, a.taskId);
  const end = Date.now();
  const minutes = Math.max(0.1, +((end - a.startedAt) / 60000).toFixed(1));
  state.logs.push({
    id: uid(),
    trackId: a.trackId,
    taskId: a.taskId,
    task: task?.text || "(deleted task)",
    start: a.startedAt,
    end,
    minutes,
    note: null,
    manual: false,
  });
  if (task) task.lastTouched = end;
  state.lastActivityAt = end;
  state.active = null;
  sendEvent("task_stopped", {
    track: track?.name || "?",
    task: task?.text || "(deleted task)",
    minutes,
  });
  commit();
}

function toggleTimer(trackId, taskId) {
  if (state.active && state.active.taskId === taskId) {
    stopTimer();
  } else {
    startTimer(trackId, taskId);
  }
}

// ── Task operations ────────────────────────────────────────────────────────
function toggleDone(trackId, taskId, done) {
  const track = findTrack(trackId);
  const task = findTask(track, taskId);
  if (!task) return;
  if (state.active?.taskId === taskId && done) stopTimer();
  task.done = done;
  task.doneAt = done ? Date.now() : null;
  task.lastTouched = Date.now();
  if (done) {
    sendEvent("task_completed", { track: track.name, task: task.text });
    if (state.frog?.taskId === taskId && state.frogCelebrated !== todayKey()) {
      state.frogCelebrated = todayKey();
      confettiBurst();
    }
  }
  commit();
}

function addTask(trackId, text) {
  const track = findTrack(trackId);
  if (!track || !text.trim()) return;
  track.tasks.push({
    id: uid(),
    text: text.trim(),
    done: false,
    doneAt: null,
    badges: [],
    createdAt: Date.now(),
    lastTouched: Date.now(),
  });
  commit();
}

function saveTaskEdit(trackId, taskId, text) {
  const task = findTask(findTrack(trackId), taskId);
  editingTaskId = null;
  if (task && text.trim()) {
    task.text = text.trim();
    task.lastTouched = Date.now();
  }
  commit();
}

function moveTask(trackId, taskId, dir) {
  const track = findTrack(trackId);
  if (!track) return;
  const i = track.tasks.findIndex((t) => t.id === taskId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= track.tasks.length) return;
  [track.tasks[i], track.tasks[j]] = [track.tasks[j], track.tasks[i]];
  commit();
}

function deleteTask(trackId, taskId) {
  const track = findTrack(trackId);
  const task = findTask(track, taskId);
  if (!task) return;
  if (!confirm(`Delete "${task.text}"? Its logged time stays in the logs.`)) return;
  if (state.active?.taskId === taskId) stopTimer();
  if (state.frog?.taskId === taskId) state.frog = null;
  track.tasks = track.tasks.filter((t) => t.id !== taskId);
  commit();
}

function setFrog(trackId, taskId) {
  if (state.frog?.taskId === taskId) {
    state.frog = null; // tap again to unset
  } else {
    state.frog = { trackId, taskId, date: todayKey() };
  }
  commit();
}

// ── Logs ───────────────────────────────────────────────────────────────────
function addManualLog(trackId, taskText, minutes, note) {
  const track = findTrack(trackId);
  if (!track || !taskText.trim() || !(minutes > 0)) return;
  const end = Date.now();
  state.logs.push({
    id: uid(),
    trackId,
    taskId: null,
    task: taskText.trim(),
    start: end - minutes * 60000,
    end,
    minutes: +(+minutes).toFixed(1),
    note: note?.trim() || null,
    manual: true,
  });
  commit();
}

function deleteLog(logId) {
  state.logs = state.logs.filter((l) => l.id !== logId);
  commit();
}

// ── Rendering ──────────────────────────────────────────────────────────────
function pillHTML(badge) {
  return `<span class="pill pill-${esc(badge.color)}">${esc(badge.text)}</span>`;
}

function renderFrog() {
  const el = $("#frog-banner");
  const info = frogInfo();
  if (!info) {
    el.innerHTML = `<div class="banner banner-empty-frog">
      🐸 No frog picked. Tap the 🐸 on your ugliest task to make it Frog of the Day.
    </div>`;
    return;
  }
  const { track, task } = info;
  if (task.done) {
    el.innerHTML = `<div class="banner banner-frog-done">
      <span class="frog-emoji">🎉</span>
      <div class="frog-text">
        <div class="frog-task">Frog conquered: ${esc(task.text)}</div>
        <div class="frog-count">The hard thing is DONE. Everything else is downhill. 💪</div>
      </div>
    </div>`;
    return;
  }
  const isActive = state.active?.taskId === task.id;
  el.innerHTML = `<div class="banner banner-frog">
    <span class="frog-emoji">🐸</span>
    <div class="frog-text">
      <div class="frog-task">${esc(task.text)} <span class="pill pill-${esc(
        track.colorName
      )}">${esc(track.name.toUpperCase())}</span></div>
      <div class="frog-count" id="frog-count">${frogCountdownText()}</div>
    </div>
    <button class="btn ${isActive ? "btn-red" : "btn-green"}"
      data-action="toggle-timer" data-track="${track.id}" data-task="${task.id}">
      ${isActive ? "⏹ Stop" : "▶️ Eat the frog"}
    </button>
  </div>`;
}

function renderSummary() {
  const { total, perTrack, earnings } = todayTotals();
  const startOfToday = dayStart();
  let doneToday = 0;
  let open = 0;
  for (const track of state.tracks) {
    for (const t of track.tasks) {
      if (t.done && t.doneAt >= startOfToday) doneToday++;
      else if (!t.done) open++;
    }
  }
  const denom = doneToday + open;
  const pct = denom ? Math.round((doneToday / denom) * 100) : 0;

  const chips = state.tracks
    .map((t) => {
      const mins = perTrack[t.id] || 0;
      return `<span class="chip" style="border-color:${t.color}">${t.emoji} ${fmtMins(
        mins
      )}</span>`;
    })
    .join("");

  $("#summary").innerHTML = `<div class="summary-card">
    <div class="summary-head">
      <h2>✅ Today's receipts</h2>
      <span class="progress-label">${doneToday}/${denom} tasks done</span>
    </div>
    <div class="stat-row">
      <div class="stat">
        <div class="stat-num">${fmtMins(total)}</div>
        <div class="stat-label">Focused</div>
      </div>
      <div class="stat">
        <div class="stat-num">${fmtMoney(earnings)}</div>
        <div class="stat-label">Est. earned</div>
      </div>
      <div class="stat">
        <div class="stat-num">${doneToday} 🎯</div>
        <div class="stat-label">Tasks done</div>
      </div>
    </div>
    <div class="track-chips">${chips}</div>
    <div class="progress-outer"><div class="progress-inner" style="width:${pct}%"></div></div>
  </div>`;
}

function staleClass(task) {
  if (task.done) return "";
  const days = (Date.now() - (task.lastTouched || task.createdAt)) / 86400000;
  if (days >= 4) return "stale-red";
  if (days >= 2) return "stale-amber";
  return "";
}

function taskHTML(track, task) {
  const isActive = state.active?.taskId === task.id;
  const isFrog = state.frog?.taskId === task.id;
  const badges = (task.badges || []).map(pillHTML).join(" ");
  const stale = staleClass(task);

  if (editingTaskId === task.id) {
    return `<li class="task" data-task-id="${task.id}">
      <input class="task-edit-input" type="text" value="${esc(task.text)}"
        data-track="${track.id}" data-task="${task.id}" autofocus />
    </li>`;
  }

  let meta = "";
  if (isActive) {
    meta = `<div class="task-meta">⏱ <span data-task-elapsed>${fmtElapsed(
      Date.now() - state.active.startedAt
    )}</span> — tap to stop</div>`;
  } else if (stale === "stale-red") {
    meta = `<div class="task-meta">😬 untouched 4+ days</div>`;
  } else if (stale === "stale-amber") {
    meta = `<div class="task-meta">👀 getting stale</div>`;
  }

  return `<li class="task ${task.done ? "done" : ""} ${
    isActive ? "active" : ""
  } ${stale} ${isFrog ? "is-frog" : ""}" data-task-id="${task.id}">
    <input type="checkbox" ${task.done ? "checked" : ""}
      data-check data-track="${track.id}" data-task="${task.id}"
      aria-label="Mark done" />
    <div class="task-main" data-action="toggle-timer"
      data-track="${track.id}" data-task="${task.id}"
      title="${task.done ? "Done" : isActive ? "Tap to stop timer" : "Tap to start timer"}">
      <div class="task-text">${isFrog ? "🐸 " : ""}${esc(task.text)} ${badges}</div>
      ${meta}
    </div>
    <div class="task-actions">
      <button class="icon-btn" title="Set as Frog of the Day" data-action="set-frog"
        data-track="${track.id}" data-task="${task.id}">🐸</button>
      <button class="icon-btn" title="Edit" data-action="edit-task"
        data-track="${track.id}" data-task="${task.id}">✏️</button>
      <button class="icon-btn" title="Move up" data-action="move-up"
        data-track="${track.id}" data-task="${task.id}">↑</button>
      <button class="icon-btn" title="Move down" data-action="move-down"
        data-track="${track.id}" data-task="${task.id}">↓</button>
      <button class="icon-btn" title="Delete" data-action="del-task"
        data-track="${track.id}" data-task="${task.id}">✕</button>
    </div>
  </li>`;
}

function logPanelHTML(track) {
  const logs = state.logs
    .filter((l) => l.trackId === track.id)
    .sort((a, b) => b.end - a.end)
    .slice(0, 40);
  const todayMins = todayTotals().perTrack[track.id] || 0;

  const entries = logs.length
    ? logs
        .map(
          (l) => `<li class="log-entry">
            <span class="log-when">${new Date(l.end).toLocaleDateString([], {
              month: "numeric",
              day: "numeric",
            })} ${fmtTime(l.start)}–${fmtTime(l.end)}</span>
            <span class="log-task">${l.manual ? "✍️ " : ""}${esc(l.task)}${
              l.note ? ` <span class="log-note">— ${esc(l.note)}</span>` : ""
            }</span>
            <span class="log-mins">${fmtMins(l.minutes)}</span>
            <button class="log-del" title="Delete entry" data-action="del-log"
              data-log="${l.id}">✕</button>
          </li>`
        )
        .join("")
    : `<li class="log-entry"><span class="log-task" style="color:var(--muted)">No sessions yet — tap a task to start the clock ⏱</span></li>`;

  return `<div class="log-panel">
    <div class="log-track-total">Today: ${fmtMins(todayMins)}${
      track.rate ? ` · ~${fmtMoney((todayMins / 60) * track.rate)}` : ""
    }</div>
    <ul class="log-entries">${entries}</ul>
    <form class="manual-entry" data-manual-track="${track.id}">
      <input type="text" name="task" placeholder="Forgot to click? Task name…" required />
      <input type="number" name="minutes" placeholder="mins" min="1" step="1" required />
      <input type="text" name="note" placeholder="note (optional)" />
      <button class="btn btn-green" type="submit">＋ Log it</button>
    </form>
    <div class="rate-row">
      💵 Rate <input type="number" min="0" step="1" value="${track.rate || 0}"
        data-rate-track="${track.id}" aria-label="Hourly rate" /> $/hr (for est. earnings)
    </div>
  </div>`;
}

function renderTracks() {
  const { perTrack } = todayTotals();
  $("#tracks").innerHTML = state.tracks
    .map((track) => {
      const openTasks = track.tasks.filter((t) => !t.done).length;
      const mins = perTrack[track.id] || 0;
      const savings = track.savings
        ? `<div class="savings">
            <div class="savings-label">
              <span>🏦 ${esc(track.savings.label)}</span>
              <span class="savings-amounts">${fmtMoney(track.savings.current)} / ${fmtMoney(
                track.savings.goal
              )}
                <button class="savings-edit" title="Update saved amount"
                  data-action="savings-edit" data-track="${track.id}">✏️</button>
              </span>
            </div>
            <div class="savings-outer"><div class="savings-inner"
              style="width:${Math.min(
                100,
                (track.savings.current / track.savings.goal) * 100
              )}%"></div></div>
          </div>`
        : "";

      return `<section class="track-card" style="border-top-color:${track.color}">
        <div class="track-head">
          <h2>${track.emoji} ${esc(track.name)} ${
            track.badge ? pillHTML(track.badge) : ""
          }</h2>
          <span class="track-today">⏱ ${fmtMins(mins)} today · ${openTasks} open</span>
        </div>
        ${track.note ? `<div class="track-note">${esc(track.note)}</div>` : ""}
        ${savings}
        <ul class="task-list">${track.tasks
          .map((t) => taskHTML(track, t))
          .join("")}</ul>
        <form class="add-task" data-add-track="${track.id}">
          <input type="text" name="text" placeholder="＋ Add a task…" />
          <button class="btn" type="submit">Add</button>
        </form>
        <button class="log-toggle" data-action="toggle-log" data-track="${track.id}">
          ${openLogs.has(track.id) ? "▾ Hide log" : "▸ Time log & manual entry"}
        </button>
        ${openLogs.has(track.id) ? logPanelHTML(track) : ""}
      </section>`;
    })
    .join("");

  const editInput = $(".task-edit-input");
  if (editInput) {
    editInput.focus();
    editInput.select();
  }
}

function renderHistory() {
  const days = [];
  let max = 1;
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const start = dayStart(d);
    const mins = state.logs
      .filter((l) => l.end >= start && l.end < start + 86400000)
      .reduce((sum, l) => sum + l.minutes, 0);
    max = Math.max(max, mins);
    days.push({ date: d, mins, isToday: i === 0 });
  }
  $("#history").innerHTML = `<div class="history-card">
    <h2>📊 Last 14 days — focused minutes</h2>
    <div class="history-bars">
      ${days
        .map(
          (d) => `<div class="hbar-wrap">
            <span class="hbar-mins">${d.mins ? Math.round(d.mins) : ""}</span>
            <div class="hbar ${d.isToday ? "today-bar" : ""}"
              style="height:${Math.max(2, (d.mins / max) * 78)}px"
              title="${d.date.toLocaleDateString()}: ${fmtMins(d.mins)}"></div>
            <span class="hbar-day">${d.date.toLocaleDateString([], {
              weekday: "narrow",
            })}${d.date.getDate()}</span>
          </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function renderWidgets() {
  const cd = state.countdown;
  $("#widgets").innerHTML = `
    <div class="widget">
      <h3>🍅 Pomodoro · 45 min</h3>
      <div class="pomo-time ${pomo.running ? "running" : ""}" id="pomo-display">${fmtElapsed(
        pomo.remaining * 1000
      )}</div>
      <div class="widget-row">
        <button class="btn btn-green" data-action="pomo-toggle">${
          pomo.running ? "⏸ Pause" : "▶️ Start"
        }</button>
        <button class="btn" data-action="pomo-reset">↺ Reset</button>
      </div>
    </div>
    <div class="widget">
      <h3>⏳ Countdown</h3>
      <div class="countdown-display" id="cd-display">${
        cd ? "…" : "— none set —"
      }</div>
      <div class="widget-row">
        <input type="text" id="cd-label" placeholder="e.g. pickup" value="" />
        <input type="time" id="cd-time" />
        <button class="btn btn-blue" data-action="cd-set">Set</button>
        ${cd ? `<button class="btn" data-action="cd-clear">✕</button>` : ""}
      </div>
    </div>
    <div class="widget data-widget">
      <h3 style="width:100%">💾 Data</h3>
      <button class="btn btn-green" data-action="export">⬇️ Export JSON</button>
      <button class="btn btn-blue" data-action="import">⬆️ Import JSON</button>
      <input type="file" id="import-file" accept="application/json" hidden />
      <button class="btn" data-action="notif-toggle">${
        state.settings.nudges ? "🔔 Nudges on" : "🔕 Enable nudges"
      }</button>
      <button class="btn btn-red" data-action="reset-seed" title="Restore the original seeded tasks (logs are wiped too)">🧹 Reset</button>
    </div>`;
  updateCountdownDisplay();
}

function render() {
  renderFrog();
  renderSummary();
  renderTracks();
  renderHistory();
}

// ── Live ticking (targeted updates — no full re-render) ────────────────────
function updateClock() {
  const now = new Date();
  let h = now.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  $("#live-clock").innerHTML = `${h}:${String(now.getMinutes()).padStart(
    2,
    "0"
  )}<span class="secs">:${String(now.getSeconds()).padStart(
    2,
    "0"
  )}</span><span class="ampm">${ampm}</span>`;
  $("#today-date").textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function updateCountdownDisplay() {
  const el = $("#cd-display");
  if (!el) return;
  const cd = state.countdown;
  if (!cd) {
    el.textContent = "— none set —";
    return;
  }
  const ms = cd.at - Date.now();
  if (ms <= 0) {
    el.textContent = `⏰ ${cd.label} — NOW!`;
    return;
  }
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  el.textContent = `${cd.label}: ${h ? h + "h " : ""}${m}m ${h ? "" : s + "s"}`;
}

function tickPomodoro() {
  if (!pomo.running) return;
  pomo.remaining = Math.max(0, Math.round((pomo.endAt - Date.now()) / 1000));
  const el = $("#pomo-display");
  if (el) el.textContent = fmtElapsed(pomo.remaining * 1000);
  if (pomo.remaining === 0 && !pomo.chimed) {
    pomo.chimed = true;
    pomo.running = false;
    chime();
    notify("🍅 Pomodoro done!", "45 minutes in the books. Stretch, water, next block.");
    renderWidgets();
  }
}

function tick() {
  updateClock();
  const frogCount = $("#frog-count");
  if (frogCount) frogCount.textContent = frogCountdownText();
  if (state.active) {
    const el = $("[data-task-elapsed]");
    if (el) el.textContent = fmtElapsed(Date.now() - state.active.startedAt);
  }
  tickPomodoro();
  updateCountdownDisplay();
}

// ── Chime (WebAudio, no assets) ────────────────────────────────────────────
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = [880, 1108.7, 1318.5][i];
      gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.55);
    });
  } catch {
    /* no audio available */
  }
}

// ── Procrastination watchdog 🐸 ────────────────────────────────────────────
function checkProcrastination() {
  const now = new Date();
  const today = todayKey();
  const hour = now.getHours() + now.getMinutes() / 60;
  const { workStartHour, workEndHour, frogDeadlineHour } = state.settings;

  // 1) Frog untouched past the deadline (default 1pm) — once per day
  const info = frogInfo();
  if (
    info &&
    !info.task.done &&
    !info.startedToday &&
    hour >= frogDeadlineHour &&
    hour < workEndHour &&
    state.alerts.frogAlertDate !== today
  ) {
    state.alerts.frogAlertDate = today;
    sendEvent("procrastination_alert", {
      reason: "frog_not_started",
      track: info.track.name,
      task: info.task.text,
      deadline_hour: frogDeadlineHour,
    });
    notify("🐸 The frog is still sitting there", `"${info.task.text}" hasn't been started yet. 15 minutes on it counts.`);
    save(state);
  }

  // 2) No timer activity for 90+ min during work hours — throttled to 90 min
  if (hour >= workStartHour && hour < workEndHour && !state.active) {
    const lastActivity = Math.max(state.lastActivityAt || 0, sessionStart);
    const idleMs = Date.now() - lastActivity;
    const sinceAlert = Date.now() - (state.alerts.lastIdleAlertAt || 0);
    if (idleMs >= 90 * 60000 && sinceAlert >= 90 * 60000) {
      state.alerts.lastIdleAlertAt = Date.now();
      sendEvent("procrastination_alert", {
        reason: "idle_during_work_hours",
        minutes_idle: Math.round(idleMs / 60000),
      });
      notify("⏱ 90+ minutes, no timer", "What are you actually doing right now? Click a task and make it count.");
      save(state);
    }
  }
}

// ── Events ─────────────────────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, track: trackId, task: taskId, log: logId } = btn.dataset;

  switch (action) {
    case "toggle-timer": {
      const task = findTask(findTrack(trackId), taskId);
      if (task && !task.done) toggleTimer(trackId, taskId);
      break;
    }
    case "set-frog":
      setFrog(trackId, taskId);
      break;
    case "edit-task":
      editingTaskId = taskId;
      render();
      break;
    case "move-up":
      moveTask(trackId, taskId, -1);
      break;
    case "move-down":
      moveTask(trackId, taskId, +1);
      break;
    case "del-task":
      deleteTask(trackId, taskId);
      break;
    case "del-log":
      deleteLog(logId);
      break;
    case "toggle-log":
      openLogs.has(trackId) ? openLogs.delete(trackId) : openLogs.add(trackId);
      render();
      break;
    case "savings-edit": {
      const t = findTrack(trackId);
      if (!t?.savings) break;
      const val = prompt(`💰 Saved so far for "${t.savings.label}":`, t.savings.current);
      if (val !== null && !isNaN(parseFloat(val))) {
        t.savings.current = Math.max(0, parseFloat(val));
        commit();
      }
      break;
    }
    case "export":
      exportJSON(state);
      break;
    case "import":
      $("#import-file").click();
      break;
    case "notif-toggle": {
      if (state.settings.nudges) {
        state.settings.nudges = false;
        save(state);
        renderWidgets();
      } else if (typeof Notification !== "undefined") {
        Notification.requestPermission().then((perm) => {
          state.settings.nudges = perm === "granted";
          save(state);
          renderWidgets();
          if (perm === "granted") notify("🔔 Nudges on", "I'll poke you when the frog goes untouched or timers go quiet.");
        });
      } else {
        alert("This browser doesn't support notifications.");
      }
      break;
    }
    case "pomo-toggle":
      if (pomo.running) {
        pomo.remaining = Math.max(0, Math.round((pomo.endAt - Date.now()) / 1000));
        pomo.running = false;
      } else {
        if (pomo.remaining === 0) pomo.remaining = pomo.total;
        pomo.endAt = Date.now() + pomo.remaining * 1000;
        pomo.running = true;
        pomo.chimed = false;
      }
      renderWidgets();
      break;
    case "pomo-reset":
      pomo.running = false;
      pomo.remaining = pomo.total;
      pomo.chimed = false;
      renderWidgets();
      break;
    case "cd-set": {
      const label = $("#cd-label").value.trim() || "countdown";
      const time = $("#cd-time").value;
      if (!time) {
        alert("Pick a time first ⏰");
        break;
      }
      const [h, m] = time.split(":").map(Number);
      const at = new Date();
      at.setHours(h, m, 0, 0);
      if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1); // tomorrow
      state.countdown = { label, at: at.getTime() };
      save(state);
      renderWidgets();
      break;
    }
    case "cd-clear":
      state.countdown = null;
      save(state);
      renderWidgets();
      break;
    case "reset-seed":
      if (confirm("Reset EVERYTHING to the original seeded tasks? Logs will be wiped. Export first if you want a backup!")) {
        state = seedState();
        commit();
        renderWidgets();
      }
      break;
  }
});

document.addEventListener("change", (e) => {
  const check = e.target.closest("[data-check]");
  if (check) {
    toggleDone(check.dataset.track, check.dataset.task, check.checked);
    return;
  }
  const rate = e.target.closest("[data-rate-track]");
  if (rate) {
    const track = findTrack(rate.dataset.rateTrack);
    if (track) {
      track.rate = Math.max(0, parseFloat(rate.value) || 0);
      commit();
    }
    return;
  }
  if (e.target.id === "import-file") {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = parseImport(text);
        state = data;
        // restore any fields the export predates
        state = Object.assign(seedState(), data);
        save(state);
        render();
        renderWidgets();
        alert("✅ Import complete!");
      } catch (err) {
        alert(`❌ Import failed: ${err.message}`);
      }
      e.target.value = "";
    });
  }
});

document.addEventListener("submit", (e) => {
  const addForm = e.target.closest("[data-add-track]");
  if (addForm) {
    e.preventDefault();
    addTask(addForm.dataset.addTrack, addForm.elements.text.value);
    return;
  }
  const manualForm = e.target.closest("[data-manual-track]");
  if (manualForm) {
    e.preventDefault();
    addManualLog(
      manualForm.dataset.manualTrack,
      manualForm.elements.task.value,
      parseFloat(manualForm.elements.minutes.value),
      manualForm.elements.note.value
    );
  }
});

// inline task editing: Enter saves, Esc cancels, blur saves
document.addEventListener("keydown", (e) => {
  const input = e.target.closest(".task-edit-input");
  if (!input) return;
  if (e.key === "Enter") {
    saveTaskEdit(input.dataset.track, input.dataset.task, input.value);
  } else if (e.key === "Escape") {
    editingTaskId = null;
    render();
  }
});

document.addEventListener(
  "blur",
  (e) => {
    const input = e.target?.closest?.(".task-edit-input");
    if (input && editingTaskId) {
      saveTaskEdit(input.dataset.track, input.dataset.task, input.value);
    }
  },
  true
);

// Hermes status dot
onPingStatus((ok) => {
  $("#hermes-dot").textContent = ok ? "🟢" : "🔴";
  $("#hermes-dot").title = ok
    ? "Hermes webhook: last ping OK"
    : "Hermes webhook: last ping failed";
});

// ── Boot ───────────────────────────────────────────────────────────────────
render();
renderWidgets();
updateClock();
setInterval(tick, 1000);
setInterval(checkProcrastination, 30000);
checkProcrastination();
