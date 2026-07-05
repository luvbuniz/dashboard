// Amy's Command Center — local config
//
// 1. Copy this file:  cp config.example.js config.js
// 2. Fill in what you use below. Anything left empty is simply skipped.
//
// config.js is gitignored so your VPS URL and bot token never land in the
// repo. If config.js is missing the dashboard still works — outbound pings
// are skipped entirely.

window.HERMES_CONFIG = {
  // Your Hermes agent endpoint. Events are POSTed here as raw JSON:
  // task_started, task_stopped, task_completed, procrastination_alert,
  // day_summary.
  HERMES_WEBHOOK_URL: "https://your-vps.example.com/hermes/webhook",

  // Optional: inbound sync — the dashboard GETs this URL (on load, every
  // 5 min, and via the 🔄 button) and merges what the agent published:
  // { agenda: [{time,title}], tasks: [{id,track,text,badge?}], message }
  // The endpoint must send Access-Control-Allow-Origin: * (CORS).
  // See README "Agent in the loop" for the full contract.
  HERMES_PULL_URL: "",

  // Optional: Telegram accountability pings (same events, human-readable).
  // 1. Make a bot with @BotFather → copy the token.
  // 2. Get your chat id: message @userinfobot, or add the bot to the group
  //    where your agent bots live and use that group's chat id.
  // ⚠️ The token controls the bot — keep it in this gitignored file only.
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
};
