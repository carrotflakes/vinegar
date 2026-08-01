import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    vanillaExtractPlugin(),
    VitePWA({
      // "prompt", not "autoUpdate": an editor must never reload itself out from
      // under a drawing in progress. A waiting worker takes over the next time
      // every Vinegar window is closed. See docs/pwa.md.
      registerType: "prompt",
      // A plain generated registerSW.js, deferred from index.html — it keeps
      // workbox-window out of the app bundle, and there is no prompt UI to
      // drive from application code.
      injectRegister: "script-defer",
      includeAssets: [
        "favicon.ico",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "logo.svg",
      ],
      workbox: {
        // The app bundle is well over Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Everything is client-side, so any navigation resolves to the shell.
        navigateFallback: "index.html",
      },
      manifest: {
        name: "Vinegar — Vector Drawing",
        short_name: "Vinegar",
        description:
          "A browser-based vector graphics editor for precise drawing and illustration.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#1c1e22",
        theme_color: "#1c1e22",
        categories: ["graphics", "productivity"],
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
  },
});
