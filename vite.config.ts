import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const PATCHED_COMPOSE_REFS = [
  'import{useCallback}from"react";',
  "function setRef(r,v){if(typeof r==='function'){r(v)}else if(r!=null){r.current=v}}",
  "function composeRefs(...refs){return(node)=>{refs.forEach(r=>setRef(r,node))}}",
  "function useComposedRefs(...refs){return useCallback(composeRefs(...refs),refs)}",
  "export{composeRefs,useComposedRefs};",
].join("\n");

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
      plugins: [
        {
          name: "patch-radix-compose-refs",
          setup(build) {
            // Intercept ALL imports that resolve to react-compose-refs and
            // redirect them into a virtual namespace where we serve the
            // patched React 18-safe code.  This guarantees esbuild never
            // bundles the original v1.1.2 code into any chunk.
            build.onResolve(
              { filter: /react-compose-refs/ },
              (args) => {
                // Only intercept when another package is importing it
                if (args.importer) {
                  return {
                    path: "radix-compose-refs-patched",
                    namespace: "radix-compose-refs-patch",
                  };
                }
                return undefined;
              },
            );

            build.onLoad(
              {
                filter: /.*/,
                namespace: "radix-compose-refs-patch",
              },
              () => ({
                contents: PATCHED_COMPOSE_REFS,
                loader: "js",
                // resolveDir lets esbuild resolve `import ... from "react"`
                resolveDir: path.resolve(
                  __dirname,
                  "node_modules/@radix-ui/react-compose-refs/dist",
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
      // Alias for any source-level / SSR imports outside the dep cache.
      "@radix-ui/react-compose-refs": path.resolve(
        __dirname,
        "src/lib/radix-compose-refs-patch.ts",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
}));
