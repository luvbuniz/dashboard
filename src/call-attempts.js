// Calling-attempt totals for Amy's call page.
//
// A logged outcome counts as one attempted call when it is a voicemail,
// a no-answer, a gatekeeper, or a live contact. Answered, interested,
// not interested, and call back are one live contact together, so tapping
// several of those on the same card does not add several attempts.
// Notes, skips, email requests, and the dial tap do not count.
//
// The encrypted lead may also carry a saved attempt number from earlier
// days (the card badge). That number is a floor. It is not added to the
// logged outcomes, because the badge often already describes those same
// calls. Adding them would archive a follow-up whose history already
// includes the voicemail.
//
// Archive at 3. A fresh/warm lead with a booked follow-up stays in the
// queue when the only reason to archive would be that saved history.
// Logged outcomes that themselves reach 3 still archive it.

export const ARCHIVE_AT = 3;

const EACH = ["voicemail", "no_answer", "gatekeeper"];
const LIVE = ["answered", "interested", "not_interested", "call_back"];

const on = (done, id, kind) => !!(done && id && done["call:" + id + ":" + kind]);

export function loggedAttemptParts(call, done) {
  const id = call && call.id;
  const parts = [];
  if (on(done, id, "voicemail")) parts.push("voicemail");
  if (on(done, id, "no_answer")) parts.push("no answer");
  if (on(done, id, "gatekeeper")) parts.push("gatekeeper");
  if (LIVE.some((k) => on(done, id, k))) parts.push("live");
  return parts;
}

export function storedAttemptCount(call) {
  if (!call) return 0;
  if (typeof call.attempts === "number" && call.attempts >= 0 && call.attempts <= 30) return Math.floor(call.attempts);
  const raw = call.attempt;
  if (typeof raw === "number" && raw >= 0 && raw <= 30) return Math.floor(raw);
  if (Array.isArray(raw)) return Math.min(30, raw.filter(Boolean).length);
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const near = s.match(/(\d+)\s*(?:st|nd|rd|th)?\s*attempts?\b/i) || s.match(/\battempt\s*#?\s*(\d+)/i);
  if (near) return Math.min(30, parseInt(near[1], 10));
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const ord = s.match(/^(\d+)(?:st|nd|rd|th)\b/i);
  if (ord) return Math.min(30, parseInt(ord[1], 10));
  return 0;
}

export function attemptTotal(call, done) {
  return Math.max(storedAttemptCount(call), loggedAttemptParts(call, done).length);
}

function signals(call) {
  if (!call) return "";
  const tags = Array.isArray(call.tags) ? call.tags.join(" ") : "";
  return [call.section, call.fit, call.script_tag, call.status, call.temperature, call.warmth, tags].filter(Boolean).join(" ");
}

export function isFreshOrWarm(call) {
  return /\b(warm|fresh|hot)\b|follow/i.test(signals(call));
}

export function hasBookedFollowUp(call, meetings, now = Date.now()) {
  if (!call) return false;
  const mark = call.follow_up || call.followup;
  if (mark) {
    const t = Date.parse(mark);
    if (!isNaN(t)) return t > now;
    return true;
  }
  if (!Array.isArray(meetings)) return false;
  return meetings.some((m) => m && m.lead_id === call.id && Date.parse(m.end || m.start) > now);
}

// Protected only when both are true: the lead reads as fresh/warm/hot/follow-up
// AND a follow-up is booked (future meeting, follow-up field, or follow-up section/tag).
export function isProtectedFollowUp(call, meetings, now = Date.now()) {
  if (!isFreshOrWarm(call)) return false;
  if (hasBookedFollowUp(call, meetings, now)) return true;
  const tags = Array.isArray(call && call.tags) ? call.tags.join(" ") : "";
  return /follow/i.test(String((call && call.section) || "")) || /follow/i.test(tags);
}

export function attemptArchived(call, done, meetings, now = Date.now()) {
  const logged = loggedAttemptParts(call, done).length;
  if (logged >= ARCHIVE_AT) return true;
  if (isProtectedFollowUp(call, meetings, now)) return false;
  return attemptTotal(call, done) >= ARCHIVE_AT;
}

export function attemptBadgeText(call, done) {
  const n = attemptTotal(call, done);
  if (!n) return "";
  const parts = loggedAttemptParts(call, done);
  return n + " attempt" + (n === 1 ? "" : "s") + (parts.length ? " · " + parts.join(", ") : "");
}

// Saved badge text that says something besides the number. Kept on the card.
export function attemptNote(call) {
  const raw = String((call && call.attempt) ?? "").trim();
  if (!raw) return "";
  const stripped = raw.replace(/\d+\s*(?:st|nd|rd|th)?/gi, "").replace(/attempts?/gi, "").replace(/[#:.,\-\s]/g, "");
  return stripped ? raw : "";
}
