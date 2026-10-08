#!/usr/bin/env node
/**
 * Fails loudly if a native/web target carries the other app's identity.
 * Usage: node scripts/verify-app-target.mjs <customer|rider> [web|native|all]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const scope = process.argv[3] || 'all';

export const TARGETS = {
  customer: { appId: 'com.customers.fastcalories.app', appName: 'Fast Calories', androidDir: 'android', webDir: 'dist', other: 'com.rider.fastcalories.app' },
  rider: { appId: 'com.rider.fastcalories.app', appName: 'FastCalories Rider', androidDir: 'android-rider', webDir: 'dist-rider', other: 'com.customers.fastcalories.app' },
};

export function checkTarget(name, scope = 'all', base = root) {
  const t = TARGETS[name];
  if (!t) return [`unknown target "${name}"`];
  const errs = [];
  const read = (p) => (existsSync(join(base, p)) ? readFileSync(join(base, p), 'utf8') : null);

  if (scope !== 'web') {
    const app = `${t.androidDir}/app`;
    const gradle = read(`${app}/build.gradle`) || '';
    if (!gradle.includes(`applicationId "${t.appId}"`)) errs.push(`${app}/build.gradle applicationId is not ${t.appId}`);
    if (gradle.includes(`applicationId "${t.other}"`)) errs.push(`${app}/build.gradle uses the other app's applicationId`);
    const strings = read(`${app}/src/main/res/values/strings.xml`) || '';
    if (!strings.includes(`<string name="app_name">${t.appName}</string>`)) errs.push(`app_name is not "${t.appName}"`);
    if (!strings.includes(`<string name="custom_url_scheme">${t.appId}</string>`)) errs.push(`custom_url_scheme is not ${t.appId}`);
    const gs = read(`${app}/google-services.json`);
    if (!gs) errs.push(`${app}/google-services.json missing`);
    else if (!JSON.parse(gs).client?.some((c) => c.client_info?.android_client_info?.package_name === t.appId))
      errs.push(`google-services.json has no client for ${t.appId}`);
    const manifest = read(`${app}/src/main/AndroidManifest.xml`) || '';
    for (const perm of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'])
      if (!manifest.includes(`android.permission.${perm}`)) errs.push(`manifest missing ${perm}`);
    if (name === 'rider') {
      if (manifest.includes('ACCESS_BACKGROUND_LOCATION')) errs.push('rider manifest must not request background location');
      if (/android:scheme="https"/.test(manifest)) errs.push('rider manifest must not claim https App Links');
      for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'])
        if (!existsSync(join(base, `${app}/src/main/res/mipmap-${d}/ic_launcher.png`))) errs.push(`rider launcher icon missing for ${d}`);
      if (!existsSync(join(base, `${app}/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`))) errs.push('rider adaptive icon missing');
      if (!existsSync(join(base, `${app}/src/main/res/drawable/ic_stat_fastcalories.xml`))) errs.push('rider notification icon missing');
    }
    const capCfg = read(`${app}/src/main/assets/capacitor.config.json`);
    if (capCfg) {
      const c = JSON.parse(capCfg);
      if (c.appId !== t.appId) errs.push(`synced capacitor.config.json appId is ${c.appId}, expected ${t.appId}`);
    }
    const plugins = read(`${app}/src/main/assets/capacitor.plugins.json`);
    if (plugins && !plugins.includes('@capacitor/geolocation')) errs.push('Geolocation plugin not registered in capacitor.plugins.json');
    const capGradle = read(`${t.androidDir}/capacitor.settings.gradle`);
    if (capGradle && !capGradle.includes('capacitor-geolocation')) errs.push('capacitor-geolocation not in capacitor.settings.gradle');
  }

  if (scope !== 'native') {
    const stamp = read(`${t.webDir}/app-variant.json`);
    if (!stamp) { if (scope === 'web') errs.push(`${t.webDir}/app-variant.json missing (not built?)`); }
    else if (JSON.parse(stamp).variant !== name) errs.push(`${t.webDir} was built as "${JSON.parse(stamp).variant}", expected "${name}"`);
    const html = read(`${t.webDir}/index.html`);
    if (name === 'rider' && html && !/FastCalories Rider/.test(read(`${t.webDir}/manifest.webmanifest`) || '')) errs.push('rider web manifest branding missing');
  }
  return errs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const errs = checkTarget(target, scope);
  if (errs.length) {
    console.error(`\n✖ ${target} target check failed:\n  - ${errs.join('\n  - ')}\n`);
    process.exit(1);
  }
  console.log(`✓ ${target} target (${scope}) identity verified`);
}
