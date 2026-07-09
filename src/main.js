import "./styles.css";
import {
  load,
  save,
  uid,
  todayKey,
  exportJSON,
  parseImport,
  seedState,
  loadConn,
  saveConn,
  getConfig,
} from "./store.js";
import { sendEvent, onPingStatus } from "./webhook.js";
import { confettiBurst } from "./confetti.js";
import { quoteForNow } from "./quotes.js";
import { pullFromAgent } from "./sync.js";

// ── Runtime state ──────────────────────────────────────────────────────────
let state = load();
const sessionStart = Date.now();
const openLogs = new Set(); // track ids with the log panel expanded
let editingTaskId = null;
let quoteOffset = 0; // bumped by the ↻ button when today's quote doesn't land
let connOpen = false; // ⚙️ agent-connection panel visibility
let syncStatus = null; // {ok, detail, at} — last pull result, shown in Data widget

const pomo = {
  mode: "work", // "work" | "break" — break auto-starts when a block ends
  remaining: 0, // seconds; initialized from settings after load
  running: false,
  endAt: null,
};

const pomoLen = (mode = pomo.mode) =>
  (mode === "work" ? state.settings.pomoWork || 25 : state.settings.pomoBreak || 5) * 60;

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
  const perTrackEarnings = {};
  let total = 0;
  let earnings = 0;
  for (const l of logs) {
    perTrack[l.trackId] = (perTrack[l.trackId] || 0) + l.minutes;
    total += l.minutes;
    // unpaid sessions (assessments, training, spec work) count as focused
    // minutes but never as money
    if (!l.unpaid) {
      const rate = findTrack(l.trackId)?.rate || 0;
      const amt = (l.minutes / 60) * rate;
      earnings += amt;
      perTrackEarnings[l.trackId] = (perTrackEarnings[l.trackId] || 0) + amt;
    }
  }
  return { total, perTrack, earnings, perTrackEarnings };
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

function dayHadActivity(startMs) {
  const end = startMs + 86400000;
  if (state.logs.some((l) => l.end >= startMs && l.end < end)) return true;
  if (state.applications.some((a) => a.at >= startMs && a.at < end)) return true;
  return state.tracks.some((tr) =>
    tr.tasks.some((t) => t.doneAt && t.doneAt >= startMs && t.doneAt < end)
  );
}

// 🔥 consecutive days with at least one timer session or check-off.
// Today doesn't break the streak until it's over — it just isn't counted
// until something happens.
function computeStreak() {
  let d = dayStart();
  const todayActive = dayHadActivity(d);
  if (!todayActive) d -= 86400000;
  let streak = 0;
  while (dayHadActivity(d) && streak < 3650) {
    streak++;
    d -= 86400000;
  }
  return { streak, todayActive };
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
  const label = task?.text || a.label || "(session)";
  const end = Date.now();
  const minutes = Math.max(0.1, +((end - a.startedAt) / 60000).toFixed(1));
  state.logs.push({
    id: uid(),
    trackId: a.trackId,
    taskId: a.taskId || null,
    task: label,
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
    task: label,
    minutes,
  });
  commit();
}

// Punch-clock session: "▶ Log In" with a freeform label, not tied to a task.
function startFreeSession(trackId, label) {
  if (state.active) stopTimer();
  const track = findTrack(trackId) || state.tracks[0];
  state.active = {
    trackId: track.id,
    taskId: null,
    label: label.trim() || "Work session",
    startedAt: Date.now(),
  };
  state.lastActivityAt = Date.now();
  sendEvent("task_started", { track: track.name, task: state.active.label });
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
    sendEvent("task_completed", {
      track: track.name,
      task: task.text,
      frog: state.frog?.taskId === taskId,
    });
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
  const wasFrog = state.frog?.taskId === taskId;
  if (wasFrog) state.frog = null;
  track.tasks = track.tasks.filter((t) => t.id !== taskId);
  // explicit signal so the agent never confuses a removal with a completion
  sendEvent("task_deleted", { track: track.name, task: task.text, frog: wasFrog });
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

// Manual entry by clock times ("In 10:30 → Out 12:30"), like the old
// checklists. "HH:MM" strings for today; an Out earlier than In is taken
// as crossing midnight.
function addManualLogTimes(trackId, taskText, tin, tout, note) {
  const track = findTrack(trackId);
  if (!track || !taskText.trim() || !tin || !tout) return;
  const [ih, im] = tin.split(":").map(Number);
  const [oh, om] = tout.split(":").map(Number);
  const start = new Date();
  start.setHours(ih, im, 0, 0);
  const end = new Date();
  end.setHours(oh, om, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  const minutes = +((end - start) / 60000).toFixed(1);
  state.logs.push({
    id: uid(),
    trackId,
    taskId: null,
    task: taskText.trim(),
    start: start.getTime(),
    end: end.getTime(),
    minutes,
    note: note?.trim() || null,
    manual: true,
  });
  commit();
}

// ── Job applications ────────────────────────────────────────────────────────
function appsToday() {
  const start = dayStart();
  return state.applications.filter((a) => a.at >= start).length;
}

// Short display label for title-less applications ("linkedin.com/…")
function urlLabel(u) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? "/…" : "");
  } catch {
    return String(u).slice(0, 40);
  }
}

// The link alone is enough — the agent identifies role/company from the
// event and syncs the real title back (see sync.js applications[]).
function logApplication(title, url) {
  const cleanUrl = /^https?:\/\//i.test(url?.trim() || "") ? url.trim() : null;
  title = title.trim();
  if (!title && !cleanUrl) return;
  const app = { id: uid(), title: title || null, url: cleanUrl, at: Date.now() };
  state.applications.push(app);
  const count = appsToday();
  sendEvent("job_applied", {
    id: app.id,
    title: app.title,
    url: cleanUrl,
    count_today: count,
    target: state.settings.jobTarget,
  });
  if (count === state.settings.jobTarget) confettiBurst(1800);
  commit();
}

// ── Calendar: future tasks & appointments ──────────────────────────────────
function addCalendarEvent(date, time, title, trackId) {
  if (!date || !title.trim()) return;
  state.events.push({
    id: uid(),
    date,
    time: time || null,
    title: title.trim(),
    trackId: trackId || null,
    done: false,
  });
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

function renderQuote() {
  const info = frogInfo();
  const q = quoteForNow({
    frogDone: !!info?.task.done,
    minutesToday: todayTotals().total,
    offset: quoteOffset,
  });
  $("#quote").innerHTML = `<div class="quote-card">
    <span class="quote-text">“${esc(q.text)}”</span>
    ${q.by ? `<span class="quote-by">— ${esc(q.by)}</span>` : ""}
    <button class="quote-shuffle" data-action="quote-shuffle" title="Another one">↻</button>
  </div>`;
}

function renderAgenda() {
  const el = $("#agenda");
  const msg =
    state.agentMessage && !state.agentMessage.dismissed
      ? `<div class="agent-msg">🤖
          <span class="agent-msg-text">${esc(state.agentMessage.text)}</span>
          <button class="icon-btn" data-action="dismiss-agent-msg" title="Dismiss">✕</button>
        </div>`
      : "";
  const a = state.agenda;
  const card =
    a?.items?.length
      ? `<div class="agenda-card">
          <h3>📅 Today <span class="agenda-when">via Hermes · synced ${fmtTime(
            a.fetchedAt
          )}</span></h3>
          <ul class="agenda-list">${a.items
            .map(
              (e) => `<li><span class="agenda-time">${esc(e.time)}</span>${esc(
                e.title
              )}</li>`
            )
            .join("")}</ul>
        </div>`
      : "";
  el.innerHTML = msg + card;
}

function renderSummary() {
  const { total, perTrack, earnings } = todayTotals();
  const { streak, todayActive } = computeStreak();
  const streakLine =
    streak === 0
      ? "🔥 Start a streak: one timer or one check-off makes today count."
      : todayActive
        ? `🔥 ${streak}-day streak — today's already in the books.`
        : `🔥 ${streak}-day streak on the line — do one thing to keep it alive.`;
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
        <div class="stat-num">${doneToday} ✅</div>
        <div class="stat-label">Tasks done</div>
      </div>
      <div class="stat">
        <div class="stat-num">${appsToday()}/${state.settings.jobTarget} 🎯</div>
        <div class="stat-label">Jobs applied</div>
      </div>
    </div>
    <div class="track-chips">${chips}</div>
    <div class="progress-outer"><div class="progress-inner" style="width:${pct}%"></div></div>
    <div class="streak-line ${todayActive ? "streak-safe" : "streak-risk"}">${streakLine}</div>
  </div>`;
}

function renderTimeLog() {
  const el = $("#timelog");
  const todayLogs = logsForDay().sort((a, b) => b.end - a.end);
  const { total } = todayTotals();

  const trackOpts = (selected) =>
    state.tracks
      .map(
        (t) =>
          `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${
            t.emoji
          } ${esc(t.name)}</option>`
      )
      .join("");

  let nowRow = "";
  if (state.active) {
    const track = findTrack(state.active.trackId);
    const task = findTask(track, state.active.taskId);
    nowRow = `<div class="now-row">
      <span class="now-live">▶</span>
      <span class="now-task">${esc(task?.text || state.active.label || "?")}
        <span class="pill pill-${esc(track?.colorName || "yellow")}">${esc(
          (track?.name || "").toUpperCase()
        )}</span></span>
      <span class="now-elapsed" data-task-elapsed>${fmtElapsed(
        Date.now() - state.active.startedAt
      )}</span>
      <button class="btn btn-red" data-action="stop-timer">⏹ Log Out</button>
    </div>`;
  } else {
    // punch clock — like the old checklists' Session Log
    nowRow = `<form class="login-row" id="free-session">
      <input type="text" name="label" placeholder="▶ Clock in: what are you on? (e.g. Job hunt)" />
      <select name="track" aria-label="Track">${trackOpts("money")}</select>
      <button class="btn btn-green" type="submit">▶ Log In</button>
    </form>`;
  }

  const rows = todayLogs.length
    ? todayLogs
        .map((l) => {
          const track = findTrack(l.trackId);
          const payToggle = track?.rate
            ? `<button class="pay-toggle ${l.unpaid ? "is-unpaid" : ""}"
                title="${
                  l.unpaid
                    ? "Unpaid (assessment/training) — not counted in earnings. Tap to count it."
                    : "Counted in earnings at $" + track.rate + "/hr. Tap to mark unpaid."
                }"
                data-action="toggle-paid" data-log="${l.id}">${l.unpaid ? "🚫" : "💵"}</button>`
            : "";
          return `<li class="log-entry">
            <span class="log-when">${fmtTime(l.start)}–${fmtTime(l.end)}</span>
            <span class="log-task">${l.manual ? "✍️ " : ""}${esc(l.task)}
              <span class="pill pill-${esc(track?.colorName || "yellow")}">${esc(
                track?.emoji || ""
              )}</span>${l.note ? ` <span class="log-note">— ${esc(l.note)}</span>` : ""}</span>
            ${payToggle}
            <span class="log-mins">${fmtMins(l.minutes)}</span>
            <button class="log-del" title="Delete entry" data-action="del-log"
              data-log="${l.id}">✕</button>
          </li>`;
        })
        .join("")
    : `<li class="log-entry"><span class="log-task" style="color:var(--muted)">Nothing logged yet — tap any task to start the clock, or log time below ⏱</span></li>`;

  el.innerHTML = `<div class="timelog-card">
    <div class="timelog-head">
      <h2>⏱ Time log — today</h2>
      <span class="timelog-total">${fmtMins(total)} on the books</span>
    </div>
    ${nowRow}
    <ul class="log-entries">${rows}</ul>
    <form class="manual-entry" id="global-manual">
      <select name="track" aria-label="Track">${trackOpts()}</select>
      <input type="text" name="task" placeholder="Forgot to clock in? What did you do?" required />
      <label class="tlabel">In <input type="time" name="tin" required /></label>
      <label class="tlabel">Out <input type="time" name="tout" required /></label>
      <input type="text" name="note" placeholder="note (optional)" />
      <button class="btn btn-green" type="submit">＋ Log it</button>
    </form>
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
  const totals = todayTotals();
  const todayMins = totals.perTrack[track.id] || 0;
  const todayEarn = totals.perTrackEarnings[track.id] || 0;

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
      track.rate ? ` · ~${fmtMoney(todayEarn)}` : ""
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

      const appsBox =
        track.id === "jobhunt"
          ? `<div class="apps-box">
              <div class="apps-head">🎯 Applications
                <span class="pill ${
                  appsToday() >= state.settings.jobTarget ? "pill-green" : "pill-yellow"
                }">${appsToday()}/${state.settings.jobTarget} TODAY</span>
                <span class="apps-total">${state.applications.length} total</span>
              </div>
              ${
                state.applications.length
                  ? `<ul class="apps-list">${[...state.applications]
                      .sort((a, b) => b.at - a.at)
                      .slice(0, 8)
                      .map(
                        (a) => `<li>
                          <span class="apps-when">${new Date(a.at).toLocaleDateString([], {
                            month: "numeric",
                            day: "numeric",
                          })}</span>
                          ${
                            a.url
                              ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(
                                  a.title || urlLabel(a.url)
                                )} ↗</a>`
                              : `<span>${esc(a.title || "?")}</span>`
                          }${a.title ? "" : ` <span class="apps-pending">🤖 identifying…</span>`}
                          <button class="log-del" title="Delete" data-action="del-app" data-app="${a.id}">✕</button>
                        </li>`
                      )
                      .join("")}</ul>`
                  : ""
              }
              <form class="apps-form" data-apps-form>
                <input type="text" name="url" placeholder="Paste the job link — that's enough ✓" inputmode="url" />
                <input type="text" name="title" placeholder="title (optional — agent fills it in)" />
                <button class="btn btn-green" type="submit">＋ Applied</button>
              </form>
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
        ${appsBox}
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

function fmtCalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtCalTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return fmtTime(d.getTime());
}

function calItemHTML(ev) {
  const track = ev.trackId ? findTrack(ev.trackId) : null;
  return `<li class="cal-item ${ev.done ? "done" : ""}">
    <input type="checkbox" ${ev.done ? "checked" : ""} data-cal-check="${ev.id}"
      aria-label="Mark done" />
    <span class="cal-time">${fmtCalTime(ev.time) || "·"}</span>
    <span class="cal-title">${ev.fromAgent ? "🤖 " : ""}${esc(ev.title)}
      ${track ? `<span class="pill pill-${esc(track.colorName)}">${track.emoji}</span>` : ""}</span>
    <button class="log-del" title="Delete" data-action="cal-del" data-event="${ev.id}">✕</button>
  </li>`;
}

function renderCalendar() {
  const el = $("#calendar");
  const today = todayKey();
  const sorted = [...state.events].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "")
  );
  const overdue = sorted.filter((e) => !e.done && e.date < today);
  const todays = sorted.filter((e) => e.date === today);
  const upcoming = sorted.filter((e) => e.date > today);

  let sections = "";
  if (overdue.length) {
    sections += `<div class="cal-day cal-overdue"><h3>😬 Overdue</h3><ul>${overdue
      .map((e) => calItemHTML({ ...e, title: `${e.title} (${fmtCalDate(e.date)})` }))
      .join("")}</ul></div>`;
  }
  if (todays.length) {
    sections += `<div class="cal-day cal-today"><h3>⭐ Today — ${fmtCalDate(
      today
    )}</h3><ul>${todays.map(calItemHTML).join("")}</ul></div>`;
  }
  const byDate = new Map();
  for (const e of upcoming) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  let shown = 0;
  for (const [date, evs] of byDate) {
    if (shown >= 10) {
      const left = [...byDate.keys()].length - shown;
      sections += `<div class="cal-more">…and ${left} more day${left > 1 ? "s" : ""} further out</div>`;
      break;
    }
    sections += `<div class="cal-day"><h3>${fmtCalDate(date)}</h3><ul>${evs
      .map(calItemHTML)
      .join("")}</ul></div>`;
    shown++;
  }
  if (!sections) {
    sections = `<div class="cal-empty">Nothing scheduled — add appointments and someday-tasks below 📅</div>`;
  }

  const trackOptions =
    `<option value="">— no track —</option>` +
    state.tracks
      .map((t) => `<option value="${t.id}">${t.emoji} ${esc(t.name)}</option>`)
      .join("");

  el.innerHTML = `<div class="cal-card">
    <h2>📅 Coming up — appointments & not-today tasks</h2>
    ${sections}
    <form class="cal-form" id="cal-form">
      <input type="date" name="date" required min="2020-01-01" />
      <input type="time" name="time" />
      <input type="text" name="title" placeholder="e.g. Dentist, McLeod deed filing…" required />
      <select name="track" aria-label="Track">${trackOptions}</select>
      <button class="btn btn-blue" type="submit">＋ Add</button>
    </form>
  </div>`;
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
      <h3>${pomo.mode === "break" ? "☕ Break" : "🍅 Pomodoro"}${
        pomo.running ? (pomo.mode === "break" ? " · breathe" : " · focus") : ""
      }</h3>
      <div class="pomo-time ${pomo.running ? "running" : ""} ${
        pomo.mode === "break" ? "on-break" : ""
      }" id="pomo-display">${fmtElapsed(pomo.remaining * 1000)}</div>
      <div class="widget-row">
        <button class="btn btn-green" data-action="pomo-toggle">${
          pomo.running ? "⏸ Pause" : "▶️ Start"
        }</button>
        <button class="btn" data-action="pomo-reset">↺ Reset</button>
      </div>
      <div class="widget-row pomo-config">
        <label>work <input type="number" min="5" max="120" step="5"
          value="${state.settings.pomoWork}" data-pomo-len="work" /></label>
        <label>break <input type="number" min="1" max="60" step="1"
          value="${state.settings.pomoBreak}" data-pomo-len="break" /></label>
        <span>min</span>
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
      <button class="btn" data-action="agent-sync" title="Pull agenda/tasks from your agent now">🔄 Sync agent</button>
      <button class="btn" data-action="conn-toggle" title="Connect Hermes / Telegram on this device">⚙️ Agent setup</button>
      <button class="btn btn-red" data-action="reset-seed" title="Restore the original seeded tasks (logs are wiped too)">🧹 Reset</button>
      <div id="sync-status" class="sync-status"></div>
    </div>
    ${connOpen ? connPanelHTML() : ""}`;
  updateCountdownDisplay();
  updateSyncStatusLine();
}

function connPanelHTML() {
  const conn = loadConn();
  const val = (k) => esc(conn[k] || "");
  return `<div class="widget conn-widget">
    <h3>⚙️ Agent connection — saved only on THIS device, never exported</h3>
    <form id="conn-form">
      <label>📥 Pull URL (where the agent publishes dashboard.json)
        <input type="text" name="HERMES_PULL_URL" value="${val("HERMES_PULL_URL")}"
          placeholder="https://api.github.com/repos/luvbuniz/buni/contents/dashboard.json" /></label>
      <label>🔑 Pull token (read-only GitHub fine-grained PAT, if using a private repo)
        <input type="password" name="HERMES_PULL_TOKEN" value="${val("HERMES_PULL_TOKEN")}"
          placeholder="github_pat_…" autocomplete="off" /></label>
      <label>🗄 GitHub events token (optional — read-write PAT so the agent can SEE your events; written to hermes/events/ in the same repo)
        <input type="password" name="GITHUB_EVENTS_TOKEN" value="${val("GITHUB_EVENTS_TOKEN")}"
          placeholder="github_pat_… (Contents: read & write)" autocomplete="off" /></label>
      <label>📤 Hermes webhook URL (optional — POSTs raw event JSON to a server)
        <input type="text" name="HERMES_WEBHOOK_URL" value="${val("HERMES_WEBHOOK_URL")}"
          placeholder="https://your-vps/hermes/webhook" /></label>
      <label>🤖 Telegram bot token (optional — events as chat messages)
        <input type="password" name="TELEGRAM_BOT_TOKEN" value="${val("TELEGRAM_BOT_TOKEN")}"
          placeholder="123456:ABC…" autocomplete="off" /></label>
      <label>💬 Telegram chat id
        <input type="text" name="TELEGRAM_CHAT_ID" value="${val("TELEGRAM_CHAT_ID")}"
          placeholder="e.g. 5510123456 or a group id" /></label>
      <div class="widget-row">
        <button class="btn btn-green" type="submit">💾 Save & sync</button>
        <button class="btn" type="button" data-action="conn-toggle">Cancel</button>
      </div>
    </form>
  </div>`;
}

function render() {
  renderQuote();
  renderFrog();
  renderAgenda();
  renderSummary();
  renderTimeLog();
  renderCalendar();
  renderTracks();
  renderHistory();
}

function syncWithAgent(manual = false) {
  return pullFromAgent(state).then((result) => {
    syncStatus = { ...result, at: Date.now() };
    if (result.changed) commit();
    updateSyncStatusLine();
    if (manual) {
      alert(
        result.ok
          ? `✅ Sync worked — ${result.detail}`
          : `❌ Sync failed: ${result.detail}`
      );
    }
  });
}

function updateSyncStatusLine() {
  const el = $("#sync-status");
  if (!el) return;
  if (!syncStatus) {
    el.textContent = "";
    return;
  }
  el.textContent = `${syncStatus.ok ? "🟢" : "🔴"} Last sync ${fmtTime(
    syncStatus.at
  )} — ${syncStatus.detail}`;
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
  if (pomo.remaining === 0) {
    chime();
    if (pomo.mode === "work") {
      // block done → break starts by itself (breaks you skip aren't breaks)
      notify(
        "🍅 Block done!",
        `${state.settings.pomoWork} focused minutes in the books. ${state.settings.pomoBreak}-min break starts now — stand up.`
      );
      pomo.mode = "break";
      pomo.remaining = pomoLen("break");
      pomo.endAt = Date.now() + pomo.remaining * 1000;
      pomo.running = true;
    } else {
      notify("☕ Break's over", "Fresh block ready when you are — hit Start.");
      pomo.mode = "work";
      pomo.remaining = pomoLen("work");
      pomo.running = false;
    }
    renderWidgets();
  }
}

// Tab title: see the pomodoro (or running session) from another tab.
const DEFAULT_TITLE = "🚀 Amy's Command Center";
function updateTabTitle() {
  let t = DEFAULT_TITLE;
  if (pomo.running) {
    t = `${fmtElapsed(pomo.remaining * 1000)} ${pomo.mode === "break" ? "☕" : "🍅"}`;
  } else if (state.active) {
    t = `▶ ${fmtElapsed(Date.now() - state.active.startedAt)} ${DEFAULT_TITLE}`;
  }
  if (document.title !== t) document.title = t;
}

function tick() {
  updateClock();
  const frogCount = $("#frog-count");
  if (frogCount) frogCount.textContent = frogCountdownText();
  if (state.active) {
    const elapsed = fmtElapsed(Date.now() - state.active.startedAt);
    document
      .querySelectorAll("[data-task-elapsed]")
      .forEach((el) => (el.textContent = elapsed));
  }
  tickPomodoro();
  updateCountdownDisplay();
  updateTabTitle();
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

  // 3) End-of-day receipt — once, when the workday closes (needs the tab open)
  if (hour >= workEndHour && state.alerts.daySummaryDate !== today) {
    const { total, earnings } = todayTotals();
    const doneCount = state.tracks.reduce(
      (n, tr) =>
        n + tr.tasks.filter((t) => t.doneAt && t.doneAt >= dayStart()).length,
      0
    );
    if (total > 0 || doneCount > 0) {
      state.alerts.daySummaryDate = today;
      sendEvent("day_summary", {
        minutes_focused: Math.round(total),
        tasks_done: doneCount,
        jobs_applied: appsToday(),
        earnings: Math.round(earnings),
        streak: computeStreak().streak,
      });
      save(state);
    }
  }

  renderQuote(); // quote category can shift as the day moves (morning → grind → evening)
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
    case "stop-timer":
      stopTimer();
      break;
    case "cal-del":
      state.events = state.events.filter((ev) => ev.id !== btn.dataset.event);
      commit();
      break;
    case "del-app":
      state.applications = state.applications.filter((a) => a.id !== btn.dataset.app);
      commit();
      break;
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
    case "toggle-paid": {
      const log = state.logs.find((l) => l.id === logId);
      if (log) {
        log.unpaid = !log.unpaid;
        commit();
      }
      break;
    }
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
        if (pomo.remaining === 0) pomo.remaining = pomoLen();
        pomo.endAt = Date.now() + pomo.remaining * 1000;
        pomo.running = true;
      }
      renderWidgets();
      break;
    case "pomo-reset":
      pomo.running = false;
      pomo.mode = "work";
      pomo.remaining = pomoLen("work");
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
    case "quote-shuffle":
      quoteOffset++;
      renderQuote();
      break;
    case "theme-toggle":
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      save(state);
      applyTheme();
      break;
    case "agent-sync":
      if (!getConfig().HERMES_PULL_URL) {
        connOpen = true;
        renderWidgets();
        alert("Tell the dashboard where your agent publishes its data first — fill in the ⚙️ Agent setup panel below 🤖");
        break;
      }
      syncWithAgent(true);
      break;
    case "conn-toggle":
      connOpen = !connOpen;
      renderWidgets();
      break;
    case "dismiss-agent-msg":
      if (state.agentMessage) state.agentMessage.dismissed = true;
      save(state);
      renderAgenda();
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
  const calCheck = e.target.closest("[data-cal-check]");
  if (calCheck) {
    const ev = state.events.find((x) => x.id === calCheck.dataset.calCheck);
    if (ev) {
      ev.done = calCheck.checked;
      commit();
    }
    return;
  }
  const pomoLenInput = e.target.closest("[data-pomo-len]");
  if (pomoLenInput) {
    const kind = pomoLenInput.dataset.pomoLen;
    const val = Math.max(1, Math.min(180, parseInt(pomoLenInput.value) || 0));
    if (kind === "work") state.settings.pomoWork = val;
    else state.settings.pomoBreak = val;
    save(state);
    if (!pomo.running && pomo.mode === kind) {
      pomo.remaining = pomoLen(kind);
      renderWidgets();
    }
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
    return;
  }
  if (e.target.id === "global-manual") {
    e.preventDefault();
    addManualLogTimes(
      e.target.elements.track.value,
      e.target.elements.task.value,
      e.target.elements.tin.value,
      e.target.elements.tout.value,
      e.target.elements.note.value
    );
    return;
  }
  if (e.target.id === "free-session") {
    e.preventDefault();
    startFreeSession(e.target.elements.track.value, e.target.elements.label.value);
    return;
  }
  const appsForm = e.target.closest("[data-apps-form]");
  if (appsForm) {
    e.preventDefault();
    logApplication(appsForm.elements.title.value, appsForm.elements.url.value);
    return;
  }
  if (e.target.id === "cal-form") {
    e.preventDefault();
    addCalendarEvent(
      e.target.elements.date.value,
      e.target.elements.time.value,
      e.target.elements.title.value,
      e.target.elements.track.value
    );
    return;
  }
  if (e.target.id === "conn-form") {
    e.preventDefault();
    const conn = {};
    for (const name of [
      "HERMES_PULL_URL",
      "HERMES_PULL_TOKEN",
      "GITHUB_EVENTS_TOKEN",
      "HERMES_WEBHOOK_URL",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
    ]) {
      conn[name] = e.target.elements[name].value.trim();
    }
    saveConn(conn);
    connOpen = false;
    renderWidgets();
    syncWithAgent(true);
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

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme() {
  const dark = state.settings.theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  const btn = $("#theme-toggle");
  if (btn) {
    btn.textContent = dark ? "☀️" : "🌙";
    btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
pomo.remaining = pomoLen("work");
applyTheme();
try {
  $("#build-stamp").textContent = `build ${__BUILD_ID__}`;
} catch {
  /* dev without define */
}
render();
renderWidgets();
updateClock();
setInterval(tick, 1000);
// Background tabs get their timers throttled by Chrome after a few minutes,
// which would freeze the tab-title countdown mid-assessment. Worker timers
// aren't throttled, so a tiny worker heartbeat keeps ticks flowing; tick()
// recomputes everything from timestamps, so extra ticks are harmless.
try {
  const workerSrc = "setInterval(() => postMessage(1), 1000);";
  const heartbeat = new Worker(
    URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" }))
  );
  heartbeat.onmessage = tick;
} catch {
  /* worker unavailable — main-thread interval still runs */
}
setInterval(checkProcrastination, 30000);
checkProcrastination();
syncWithAgent();
setInterval(syncWithAgent, 5 * 60000);

// PWA: offline shell + self-update so the installed home-screen app never
// gets stuck on a stale build. When a new service worker takes control we
// reload exactly once to pick up the latest assets.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      reg.update();
      // check for a new deploy each time the app regains focus
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update();
      });
    })
    .catch(() => {});
}
