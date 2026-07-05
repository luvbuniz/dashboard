import { defineConfig } from "vite";

// Relative base so the built app works from any URL —
// GitHub Pages (https://user.github.io/dashboard/), a VPS subfolder, or file hosting.
export default defineConfig({
  base: "./",
  define: {
    // Shown in the footer so it's always obvious which build is loaded.
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"
    ),
  },
});
