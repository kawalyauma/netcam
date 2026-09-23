import { defineConfig } from "vite";

// Captive portal must load fast on a fresh, often-throttled WiFi
// association — single small JS/CSS bundle, no code splitting overhead,
// no framework runtime.
export default defineConfig({
  build: {
    target: "es2018",
    cssCodeSplit: false,
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    proxy: {
      "/portal": "http://localhost:8787",
    },
  },
});
