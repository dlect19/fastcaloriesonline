import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";

/**
 * React 18-safe replacement for @radix-ui/react-compose-refs v1.1.2.
 * Strips `return ref(value)` and cleanup-tracking to prevent infinite
 * setState loops in React 18.
 */
const SAFE_COMPOSE_REFS = `
import * as React from "react";
function setRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null && ref !== void 0) {
    ref.current = value;
  }
}
function composeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => setRef(ref, node));
  };
}
function useComposedRefs(...refs) {
  return React.useCallback(composeRefs(...refs), refs);
}
export { composeRefs, useComposedRefs };
`;

/**
 * Vite/Rollup plugin that replaces every instance of
 * @radix-ui/react-compose-refs (including nested copies inside other
 * Radix packages) with a React 18-safe version.  Works during both
 * dev-serve (Vite transform) and production build (Rollup transform).
 */
function patchComposeRefs(): Plugin {
  return {
    name: "patch-radix-compose-refs",
    enforce: "pre",
    transform(code, id) {
      // Match any path that resolves to react-compose-refs dist files,
      // including nested node_modules copies like:
      //   node_modules/@radix-ui/react-presence/node_modules/@radix-ui/react-compose-refs/dist/index.mjs
      //   node_modules/@radix-ui/react-slot/node_modules/@radix-ui/react-compose-refs/dist/index.mjs
      //   node_modules/@radix-ui/react-compose-refs/dist/index.mjs
      if (id.includes("react-compose-refs") && (id.endsWith(".mjs") || id.endsWith(".js"))) {
        return { code: SAFE_COMPOSE_REFS, map: null };
      }

      // Also patch pre-bundled Vite dep chunks that inline compose-refs code
      if (id.includes(".vite/deps/") && code.includes("return ref(value)") && code.includes("composeRefs")) {
        // Replace just the setRef return pattern in bundled chunks
        const patched = code.replace(
          /return ref\(value\)/g,
          "ref(value)"
        );
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
