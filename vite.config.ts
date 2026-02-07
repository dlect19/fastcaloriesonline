import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";

/**
 * Vite plugin that patches @radix-ui/react-compose-refs v1.1.2 code at
 * serve-time.  The v1.1.2 `setRef` does `return ref(value)` which triggers
 * infinite re-render loops in React 18 because callback refs that return
 * values (state dispatchers) are re-invoked endlessly.
 *
 * This plugin rewrites the compose-refs code in pre-bundled chunks so that
 * `setRef` never returns, and the cleanup-tracking logic is stripped.
 */
function patchComposeRefs(): Plugin {
  return {
    name: "patch-radix-compose-refs",
    enforce: "pre",
    transform(code, id) {
      // Only process pre-bundled dep chunks and the compose-refs source
      if (
        !id.includes("react-compose-refs") &&
        !id.includes(".vite/deps/")
      ) {
        return null;
      }

      // Quick check: does this module contain the buggy pattern?
      if (!code.includes("return ref(value)")) {
        return null;
      }

      // Replace the entire compose-refs module code with a React 18-safe version.
      // We target the specific function patterns from v1.1.2.
      let patched = code;

      // Fix setRef: remove the `return` so the ref callback result isn't forwarded
      patched = patched.replace(
        /function setRef\(ref,\s*value\)\s*\{[\s\S]*?if\s*\(typeof ref === "function"\)\s*\{\s*return ref\(value\);/g,
        'function setRef(ref, value) {\n  if (typeof ref === "function") {\n    ref(value);'
      );

      // Replace the composeRefs function that uses cleanup tracking with a simple version
      patched = patched.replace(
        /function composeRefs\(\.\.\.refs\)\s*\{[\s\S]*?let hasCleanup[\s\S]*?return[\s\S]*?\}\s*;\s*\}\s*;?\s*\}/g,
        'function composeRefs(...refs) {\n    return (node) => {\n      refs.forEach((ref) => setRef(ref, node));\n    };\n  }'
      );

      if (patched !== code) {
        return { code: patched, map: null };
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
    patchComposeRefs(),
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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
}));
