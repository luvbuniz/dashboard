import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptArchived,
  attemptBadgeText,
  attemptNote,
  attemptTotal,
  loggedAttemptParts,
  storedAttemptCount,
} from "./call-attempts.js";

const NOW = Date.parse("2026-11-06T18:00:00Z");
const done = (id, kinds) => {
  const out = {};
  for (const k of kinds) out["call:" + id + ":" + k] = "2026-11-06T15:00:00Z";
  return out;
};
const lead = (extra) => ({ id: "L", name: "Ada", company: "Example Co", ...extra });

test("voicemail with a blank attempt badge counts as 1 and stays in the queue", () => {
  const c = lead({});
  const d = done("L", ["voicemail"]);
  assert.deepEqual(loggedAttemptParts(c, d), ["voicemail"]);
  assert.equal(attemptTotal(c, d), 1);
  assert.equal(attemptBadgeText(c, d), "1 attempt · voicemail");
  assert.equal(attemptArchived(c, d, [], NOW), false);
});

test("no answer counts as one attempt", () => {
  const c = lead({});
  const d = done("L", ["no_answer"]);
  assert.equal(attemptTotal(c, d), 1);
  assert.equal(attemptBadgeText(c, d), "1 attempt · no answer");
  assert.equal(attemptArchived(c, d, [], NOW), false);
});

test("live contact buttons on one card count as one attempt", () => {
  const c = lead({});
  const d = done("L", ["answered", "interested", "not_interested", "call_back"]);
  assert.deepEqual(loggedAttemptParts(c, d), ["live"]);
  assert.equal(attemptTotal(c, d), 1);
  assert.equal(attemptArchived(c, d, [], NOW), false);
});

test("voicemail, no answer, and a live contact are three attempts and archive", () => {
  const c = lead({ attempt: "" });
  const d = done("L", ["voicemail", "no_answer", "answered"]);
  assert.deepEqual(loggedAttemptParts(c, d), ["voicemail", "no answer", "live"]);
  assert.equal(attemptTotal(c, d), 3);
  assert.equal(attemptArchived(c, d, [], NOW), true);
});

test("gatekeeper counts, and skip, note, email, and dial do not", () => {
  const c = lead({});
  assert.equal(attemptTotal(c, done("L", ["gatekeeper"])), 1);
  assert.equal(attemptTotal(c, done("L", ["skip", "note", "email", "dialed"])), 0);
  assert.equal(attemptArchived(c, done("L", ["skip"]), [], NOW), false);
});

test("a saved attempt number of 3 archives when there is no booked follow-up", () => {
  for (const attempt of ["3", "3 attempts", "Attempt 3", "3rd attempt", 3]) {
    const c = lead({ attempt });
    assert.equal(storedAttemptCount(c), 3, String(attempt));
    assert.equal(attemptArchived(c, {}, [], NOW), true, String(attempt));
  }
});

test("saved history is a floor, not added on top of the same card's ticks", () => {
  const c = lead({ attempt: "2 attempts" });
  const d = done("L", ["voicemail"]);
  assert.equal(attemptTotal(c, d), 2);
  assert.equal(attemptBadgeText(c, d), "2 attempts · voicemail");
  assert.equal(attemptArchived(c, d, [], NOW), false);
});

test("a warm lead with a booked follow-up is not archived for past attempts", () => {
  const c = lead({ section: "Hot follow-ups", fit: "Warm", attempt: "3 attempts" });
  const meetings = [{ lead_id: "L", start: "2026-11-09T15:00:00Z", end: "2026-11-09T15:30:00Z" }];
  assert.equal(attemptArchived(c, done("L", ["voicemail"]), meetings, NOW), false);
  assert.equal(attemptTotal(c, done("L", ["voicemail"])), 3);
});

test("a warm booked follow-up still archives when logged outcomes reach 3", () => {
  const c = lead({ section: "Hot follow-ups", fit: "Warm", attempt: "1" });
  const meetings = [{ lead_id: "L", start: "2026-11-09T15:00:00Z", end: "2026-11-09T15:30:00Z" }];
  const d = done("L", ["voicemail", "no_answer", "answered", "interested"]);
  assert.equal(attemptArchived(c, d, meetings, NOW), true);
});

test("a past meeting does not protect a warm lead that already has 3 saved attempts", () => {
  const c = lead({ fit: "Warm", section: "West Coast", attempt: "3 attempts" });
  const meetings = [{ lead_id: "L", start: "2026-11-01T15:00:00Z", end: "2026-11-01T15:30:00Z" }];
  assert.equal(attemptArchived(c, {}, meetings, NOW), true);
});

test("the hot follow-up section stays in the queue until logged outcomes reach 3", () => {
  const c = lead({ section: "Hot follow-ups", attempt: "3 attempts" });
  assert.equal(attemptArchived(c, {}, [], NOW), false);
  assert.equal(attemptArchived(c, done("L", ["voicemail", "no_answer", "gatekeeper"]), [], NOW), true);
});

test("offer and long-shot labels do not archive by themselves", () => {
  const offer = lead({ tags: ["Offer sent"], section: "Long shots" });
  assert.equal(attemptTotal(offer, {}), 0);
  assert.equal(attemptArchived(offer, {}, [], NOW), false);
  const vm = lead({ tags: ["Offer sent"], section: "Long shots" });
  assert.equal(attemptArchived(vm, done("L", ["voicemail"]), [], NOW), false);
});

test("a prose attempt note is kept beside the counted badge", () => {
  const c = lead({ attempt: "left voicemail for Melissa" });
  assert.equal(storedAttemptCount(c), 0);
  assert.equal(attemptNote(c), "left voicemail for Melissa");
  assert.equal(attemptTotal(c, done("L", ["voicemail"])), 1);
});

test("live tick store: every voicemail counts, and no single id has 3 outcome types", async () => {
  const res = await fetch("https://amy-dashboard-ticks.sullivanamy75.workers.dev/state");
  assert.equal(res.ok, true);
  const { done: ticks } = await res.json();
  const ids = new Set();
  for (const key of Object.keys(ticks)) {
    const m = key.match(/^call:(.+):voicemail$/);
    if (m) ids.add(m[1]);
  }
  assert.ok(ids.size >= 1, "expected logged voicemails");
  let archived = 0;
  for (const id of ids) {
    const c = { id };
    assert.ok(attemptTotal(c, ticks) >= 1, id);
    assert.match(attemptBadgeText(c, ticks), /voicemail/);
    if (attemptArchived(c, ticks, [], NOW)) archived++;
  }
  assert.equal(archived, 0, "tick flags alone should not already be 3 on one id");
  assert.equal(attemptTotal({ id: "1030-16" }, ticks), 2);
  assert.deepEqual(loggedAttemptParts({ id: "1105-33" }, ticks), ["live"]);
  assert.equal(attemptTotal({ id: "1106-22" }, ticks), 1);
  assert.equal(loggedAttemptParts({ id: "1106-22" }, ticks).includes("live"), true);
});
