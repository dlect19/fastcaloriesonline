import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // Important: avoid service worker caching during development previews,
      // which can lead to mixed old/new bundles and invalid hook call errors.
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.ico", "images/fast-calories-logo.png"],
      manifest: {
        name: "Fast Calories - Eat Smart, Live Healthy",
        short_name: "Fast Calories",
        description: "Nigeria's #1 health-aware food delivery platform. Track calories, order healthy meals, and achieve your health goals.",
        theme_color: "#16a34a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB limit
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  optimizeDeps: {
    // Force Vite to re-bundle deps so the patched compose-refs is picked up.
    force: true,
    esbuildOptions: {
      plugins: [
        {
          name: "patch-radix-compose-refs",
          setup(build) {
            // Intercept the package during esbuild dep pre-bundling so every
            // Radix primitive that imports compose-refs gets our React 18 patch.
            build.onResolve(
              { filter: /^@radix-ui\/react-compose-refs/ },
              () => ({
                path: path.resolve(
                  __dirname,
                  "src/lib/radix-compose-refs-patch.ts",
                ),
              }),
            );
          },
        },
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Also alias for any source-level / SSR imports outside the dep cache.
      "@radix-ui/react-compose-refs": path.resolve(
        __dirname,
        "src/lib/radix-compose-refs-patch.ts",
      ),
    },
    // Prevent duplicate React copies in the dependency graph.
    dedupe: ["react", "react-dom"],
  },
}));
