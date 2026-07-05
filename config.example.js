// Amy's Command Center — local config
//
// 1. Copy this file:  cp config.example.js config.js
// 2. Fill in your Hermes webhook URL below.
//
// config.js is gitignored so your VPS URL never lands in the repo.
// If config.js is missing the dashboard still works — webhook pings
// are simply skipped.

window.HERMES_CONFIG = {
  // Your Hermes agent endpoint. Events are POSTed here as JSON.
  HERMES_WEBHOOK_URL: "https://your-vps.example.com/hermes/webhook",
};
