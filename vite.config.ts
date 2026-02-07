import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const safeComposeRefsPath = path.resolve(
  __dirname,
  "./src/lib/safe-compose-refs.ts"
);

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
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.ico", "images/fast-calories-logo.png"],
      manifest: {
        name: "Fast Calories - Eat Smart, Live Healthy",
        short_name: "Fast Calories",
        description:
          "Nigeria's #1 health-aware food delivery platform. Track calories, order healthy meals, and achieve your health goals.",
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
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
    force: true,
    esbuildOptions: {
      // Intercept @radix-ui/react-compose-refs during Vite's dependency
      // pre-bundling (esbuild phase). This ensures that even when other
      // Radix packages import compose-refs internally, esbuild resolves
      // it to our safe local implementation.
      plugins: [
        {
          name: "redirect-compose-refs",
          setup(build) {
            build.onResolve(
              { filter: /^@radix-ui\/react-compose-refs$/ },
              () => ({
                path: safeComposeRefsPath,
              })
            );
          },
        },
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Also alias for non-pre-bundled contexts (SSR, production build)
      "@radix-ui/react-compose-refs": safeComposeRefsPath,
    },
    dedupe: ["react", "react-dom"],
  },
}));
