# Capacitor Branding Assets

This folder holds the **master icons and splash screens** for each of the three
Capacitor apps that share this codebase:

```
resources/
├── customer/   ← FastCalories Customer master assets
├── vendor/     ← FastCalories Vendor master assets
├── rider/      ← FastCalories Rider master assets
├── icon.png    ← ACTIVE icon used by capacitor-assets generate
└── splash.png  ← ACTIVE splash used by capacitor-assets generate
```

## How it works

`@capacitor/assets` always reads `resources/icon.png` and `resources/splash.png`.
Before generating, we copy the chosen app's masters into those two slots.

## Usage

```bash
# Customer build
npm run assets:customer
npx cap sync

# Vendor build
npm run assets:vendor
npx cap sync

# Rider build
npm run assets:rider
npx cap sync
```

Each script:
1. Copies `resources/<app>/icon.png`   → `resources/icon.png`
2. Copies `resources/<app>/splash.png` → `resources/splash.png`
3. Runs `npx capacitor-assets generate`

## ⚠️ Safety

This system **only** swaps source images for the asset generator. It does **not**
touch package names, `capacitor.config.ts`, Firebase, Supabase, auth, or any
app logic. The currently published Customer app is unaffected until you
explicitly run a new generate + cap sync + release build.

## Rider icon

A dedicated `resources/rider/icon.png` has not been provided yet — the rider
splash artwork is in there as a placeholder. Replace it with the real rider
app-icon PNG before running `npm run assets:rider`.
