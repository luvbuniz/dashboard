import { defineConfig } from "vite";

// Relative base so the built app works from any URL —
// GitHub Pages (https://user.github.io/dashboard/), a VPS subfolder, or file hosting.
export default defineConfig({
  base: "./",
});
