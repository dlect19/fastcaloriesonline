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
            // Replace the CONTENT of compose-refs at load time so the fix
            // is inlined into every pre-bundled Radix chunk.  onResolve
            // redirects don't work reliably for .ts files in this context.
            build.onLoad(
              { filter: /react-compose-refs[\\/]dist[\\/]index\.mjs$/ },
              () => ({
                contents: [
                  'import{useCallback}from"react";',
                  "function setRef(r,v){if(typeof r==='function'){r(v)}else if(r!=null){r.current=v}}",
                  "function composeRefs(...refs){return(node)=>{refs.forEach(r=>setRef(r,node))}}",
                  "function useComposedRefs(...refs){return useCallback(composeRefs(...refs),refs)}",
                  "export{composeRefs,useComposedRefs};",
                ].join("\n"),
                loader: "js",
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
