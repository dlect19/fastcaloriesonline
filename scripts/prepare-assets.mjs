#!/usr/bin/env node
/**
 * Copies resources/<app>/{icon,splash}.png into resources/{icon,splash}.png
 * so that `npx capacitor-assets generate` produces the right branding for
 * the chosen app (customer | vendor | rider).
 *
 * Usage: node scripts/prepare-assets.mjs <customer|vendor|rider>
 *
 * NOTE: This does NOT change package names, capacitor.config, Firebase,
 * Supabase or any app logic. It only swaps the source images that feed
 * the asset generator.
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const app = (process.argv[2] || "").toLowerCase();

const valid = ["customer", "vendor", "rider"];
if (!valid.includes(app)) {
  console.error(`\n✖ Unknown app "${app}". Use one of: ${valid.join(", ")}\n`);
  process.exit(1);
}

const srcDir = resolve(root, "resources", app);
const dstDir = resolve(root, "resources");

for (const file of ["icon.png", "splash.png"]) {
  const src = resolve(srcDir, file);
  const dst = resolve(dstDir, file);
  if (!existsSync(src)) {
    console.error(`✖ Missing ${src}. Place the master ${file} for "${app}" there.`);
    process.exit(1);
  }
  copyFileSync(src, dst);
  console.log(`✓ ${app}/${file} → resources/${file}`);
}

console.log(`\n✔ Active assets switched to "${app}". Now run: npx capacitor-assets generate\n`);
