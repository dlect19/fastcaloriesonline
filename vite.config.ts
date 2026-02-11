import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const safeComposeRefsPath = path.resolve(
  __dirname,
  "./src/lib/safe-compose-refs.ts"
);

/**
 * Vite plugin that patches the pre-bundled compose-refs code in .vite/deps chunks.
 * The original Radix compose-refs v1.1.2 has `return ref(value)` inside setRef,
 * which causes infinite re-renders in React 18 when the ref is a state dispatcher
 * (e.g. from Radix Presence). This plugin strips the `return` so setRef returns void.
 */
function patchComposeRefsInChunks(): Plugin {
  return {
    name: "patch-compose-refs-chunks",
    enforce: "pre",
    transform(code, id) {
      // Patch pre-bundled dependency chunks that contain compose-refs code
      if (
        id.includes("node_modules/.vite/deps/") &&
        code.includes("setRef") &&
        code.includes("composeRefs")
      ) {
        // Replace "return ref(value)" with "ref(value)" inside setRef functions
        const patched = code.replace(
          /function setRef\b[^}]*\breturn\s+ref\(value\)/g,
          (match) => match.replace(/return\s+ref\(value\)/, "ref(value)")
        );
        if (patched !== code) {
          return { code: patched, map: null };
        }
      }

      // Also catch the direct module file if it somehow bypasses the alias
      if (
        id.includes("react-compose-refs") &&
        (id.endsWith(".mjs") || id.endsWith(".js"))
      ) {
        const patched = code.replace(/return\s+ref\(value\)/g, "ref(value)");
        if (patched !== code) {
          return { code: patched, map: null };
        }
      }

      return null;
    },
  };
}

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
    patchComposeRefsInChunks(),
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "prompt",
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
        navigateFallbackDenylist: [/^\/~oauth/],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
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
    exclude: ["@radix-ui/react-compose-refs"],
    esbuildOptions: {
      plugins: [
        {
          name: "redirect-compose-refs",
          setup(build) {
            build.onResolve(
              { filter: /react-compose-refs/ },
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
      "@radix-ui/react-compose-refs": safeComposeRefsPath,
    },
    dedupe: ["react", "react-dom"],
  },
}));
