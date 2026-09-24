#!/usr/bin/env node
// Fails the build if the customer entry bundle can load/play the order tone,
// or if any packaged Capacitor web assets still carry the legacy muted-MP3
// unlock routine. Usage: node scripts/assert-no-customer-order-audio.mjs [distDir]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.resolve(root, process.argv[2] || 'dist');

export const LEGACY_UNLOCK = /volume\s*=\s*0[\s\S]{0,200}\.play\(\)/;
export const GESTURE_AUDIO =
  /addEventListener\(\s*["'`](?:click|touchstart|pointerdown|keydown)["'`][\s\S]{0,400}(?:new Audio|\.play\(\)|unlockAudio)/;
const ORDER_FILE = /new-order\.mp3/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

export function scanEntry(code) {
  const problems = [];
  if (ORDER_FILE.test(code)) problems.push('contains new-order.mp3');
  if (LEGACY_UNLOCK.test(code)) problems.push('contains legacy volume=0 + play() unlock');
  if (GESTURE_AUDIO.test(code)) problems.push('contains a global gesture-to-audio handler');
  return problems;
}

function main() {
  const failures = [];
  const html = path.join(dist, 'index.html');
  if (!existsSync(html)) {
    console.error(`[audio-guard] ${html} missing`);
    process.exit(1);
  }
  const entries = [...readFileSync(html, 'utf8').matchAll(/src="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  if (!entries.length) failures.push('no entry script found in index.html');
  for (const rel of entries) {
    const probs = scanEntry(readFileSync(path.join(dist, rel), 'utf8'));
    probs.forEach((p) => failures.push(`customer entry ${rel}: ${p}`));
  }
  for (const dir of ['android/app/src/main/assets/public', 'ios/App/App/public']) {
    for (const f of walk(path.join(root, dir))) {
      if (LEGACY_UNLOCK.test(readFileSync(f, 'utf8'))) {
        failures.push(`packaged native asset ${path.relative(root, f)}: legacy volume=0 + play() unlock`);
      }
    }
  }
  if (failures.length) {
    console.error('[audio-guard] FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log(`[audio-guard] OK — ${entries.length} entry file(s) clean, native assets clean`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
