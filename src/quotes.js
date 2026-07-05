// ── Daily quotes that fit the day 💛 ───────────────────────────────────────
// Picked by context (time of day, whether the frog is eaten, whether any
// minutes are logged yet), then rotated deterministically by date so the
// quote stays put all day instead of changing on every render.

export const QUOTES = {
  // before ~11am — getting rolling
  morning: [
    { text: "Eat a live frog first thing in the morning and nothing worse will happen to you the rest of the day.", by: "attributed to Mark Twain" },
    { text: "How we spend our days is, of course, how we spend our lives.", by: "Annie Dillard" },
    { text: "Start where you are. Use what you have. Do what you can.", by: "Arthur Ashe" },
    { text: "You do not rise to the level of your goals. You fall to the level of your systems.", by: "James Clear" },
    { text: "What you do every day matters more than what you do once in a while.", by: "Gretchen Rubin" },
    { text: "A year from now you may wish you had started today.", by: "Karen Lamb" },
    { text: "First the timer, then the feelings. 🐸", by: "the Frog" },
  ],
  // 11am+ with zero minutes logged — the lazy-day, shame-free nudges
  stuck: [
    { text: "Action isn't just the effect of motivation; it's also the cause of it.", by: "Mark Manson" },
    { text: "Nothing is so fatiguing as the eternal hanging on of an uncompleted task.", by: "William James" },
    { text: "Just take it bird by bird.", by: "Anne Lamott" },
    { text: "The scariest moment is always just before you start.", by: "Stephen King" },
    { text: "Done is better than perfect.", by: "" },
    { text: "Just five minutes. You're allowed to quit after five minutes. (You won't.)", by: "the Frog 🐸" },
    { text: "You don't have to feel like it. You just have to press start.", by: "the Frog 🐸" },
    { text: "A lazy morning doesn't cancel the day. The next timer does. 🌱", by: "the Frog 🐸" },
  ],
  // normal working afternoon
  grind: [
    { text: "It always seems impossible until it's done.", by: "Nelson Mandela" },
    { text: "The best way out is always through.", by: "Robert Frost" },
    { text: "You can do anything, but not everything.", by: "David Allen" },
    { text: "Focus on being productive instead of busy.", by: "Tim Ferriss" },
    { text: "Momentum or it dies. Small daily touches count.", by: "Amy — Stackadoo rule" },
    { text: "Receipts beat vibes.", by: "house motto" },
    { text: "The work you do while you procrastinate is probably the work you should be doing for the rest of your life.", by: "Jessica Hische" },
  ],
  // the frog is DONE — victory lap
  celebrate: [
    { text: "Well done is better than well said.", by: "Benjamin Franklin" },
    { text: "Success is the sum of small efforts, repeated day in and day out.", by: "Robert Collier" },
    { text: "The frog never stood a chance. 💪", by: "the Frog 🐸 (defeated)" },
    { text: "Hard thing's done. Everything else today is dessert. 🍰", by: "the Frog 🐸" },
    { text: "Your brain keeps score of every small win. Today it wrote one down.", by: "" },
  ],
  // after the workday
  evening: [
    { text: "Finish each day and be done with it. You have done what you could.", by: "Ralph Waldo Emerson" },
    { text: "Rest is not idleness.", by: "John Lubbock" },
    { text: "Tomorrow is always fresh, with no mistakes in it.", by: "L. M. Montgomery" },
    { text: "Don't count the days; make the days count.", by: "Muhammad Ali" },
    { text: "The day is logged. Close the tab. Go live. 💛", by: "the Frog 🐸" },
  ],
};

export function quoteForNow({ frogDone, minutesToday, offset = 0, date = new Date() }) {
  let cat;
  const h = date.getHours();
  if (frogDone) cat = "celebrate";
  else if (h >= 18 || h < 4) cat = "evening";
  else if (h < 11) cat = "morning";
  else if (minutesToday === 0) cat = "stuck";
  else cat = "grind";

  const list = QUOTES[cat];
  // local day number → same quote all day, different tomorrow
  const dayN = Math.floor(
    (date.getTime() - date.getTimezoneOffset() * 60000) / 86400000
  );
  const q = list[(((dayN + offset) % list.length) + list.length) % list.length];
  return { ...q, cat };
}
