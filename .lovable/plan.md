# Plan: Drug Reminder Fix + Tri-App Brand Theming

## Part 1 — Drug reminders (bug fix)

The `process-drug-reminders` edge function is implemented but **never invoked by cron**, so customers never receive push notifications. Tracking (manual "mark as taken") works.

**Fix (one migration):**
```sql
SELECT cron.schedule(
  'process-drug-reminders',
  '* * * * *',              -- every minute; function has 2-min match window
  $$ SELECT net.http_post(
       url := '<edge-fn-url>/process-drug-reminders',
       headers := jsonb_build_object('Authorization','Bearer <service-role>')
     ); $$
);
```
After this, reminders dispatch automatically. The customer's `/drug-tracker` page already shows progress and lets them confirm doses.

## Part 2 — Tri-app brand themes

### Color tokens per app
| Token | Customer | Vendor | Rider |
|---|---|---|---|
| `--primary` | `#F97316` orange | `#2563EB` blue | `#16A34A` green |
| `--secondary` | `#16A34A` green | `#F97316` orange | `#15803D` dark green |
| `--accent` | `#FDBA74` amber | `#60A5FA` sky | `#84CC16` lime |
| `--card` | `#FFF8F1` | `#F8FAFC` | `#F0FDF4` |
| `--background` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--success` | green | green | green |
| `--warning` | amber | amber | amber |
| `--destructive` | red | red | red |
| `--info` | blue | blue | blue |

### Theme detection (both modes)
`src/lib/appTheme.ts` resolves variant in this order:
1. `import.meta.env.VITE_APP_VARIANT` (`customer` | `vendor` | `rider`) — set per native build
2. Route prefix fallback: `/vendor/*` → vendor, `/rider/*` `/delivery/*` → rider, else customer
3. Applied by adding `data-app="vendor|rider|customer"` to `<html>` on every route change

### CSS structure (`src/index.css`)
Keep existing `:root` as customer defaults. Add:
```css
:root[data-app="vendor"]  { --primary: 217 91% 60%; --secondary: 25 95% 53%; --accent: 213 94% 68%; --card: 210 40% 98%; --ring: 217 91% 60%; --sidebar-primary: 217 91% 60%; ... }
:root[data-app="rider"]   { --primary: 142 71% 45%; --secondary: 142 64% 36%; --accent: 82 78% 44%; --card: 138 76% 97%; --ring: 142 71% 45%; --sidebar-primary: 142 71% 45%; ... }
```
All values stored as HSL triplets (matches existing token format). Sidebar tokens themed too.

### What auto-themes (no component edits)
Anything already using semantic tokens: `bg-primary`, `text-primary`, `border-primary`, `bg-card`, `bg-secondary`, `bg-accent`, `ring-primary`, button variants, badge variants, shadcn sidebar, navlinks. Estimated 90% of the app.

### What I'll touch manually (highest-visibility surfaces)
- Auth shells: `Auth.tsx`, `VendorAuth.tsx`, `RiderAuth.tsx`, `DeliveryCompanyAuth.tsx`, `OrganizerAuth.tsx`, `ForgotPasswordModal.tsx` — ensure they all read from tokens.
- Splash: capacitor `backgroundColor` per build (already groundwork in `prepare-assets.mjs`).
- Header logos: tint via `text-primary` instead of hardcoded hex.
- Bottom nav (customer + rider): swap any hardcoded green/orange to `text-primary`.
- Floating action buttons (rider widget, vendor POS): `bg-primary`.
- Loading spinners: ensure `Loader2` uses `text-primary` (most already do).

### What I'll NOT touch this pass (per "tokens only, safe")
- Calorie color scale (semantic — green/amber/red are meaningful, not branding)
- Status badges where red/green/amber communicate state
- Charts (recharts already inherits theme via CSS vars where set)
- Promotional/marketing landing pages (`EventPlannersLanding`, `RiderLanding`, `VendorLanding`, `DeliveryCompanyLanding`) — those are public marketing pages with their own art direction; ask before re-tinting
- Google Maps tiles

### Files
**New:** `src/lib/appTheme.ts`, `src/hooks/useAppTheme.ts`, `supabase/migrations/<ts>_schedule_drug_reminders.sql`
**Edit:** `src/index.css` (add `[data-app]` blocks), `src/App.tsx` (mount theme hook), `tailwind.config.ts` (no change — tokens already wired), capacitor.config.ts background color note in README.

### Typography & radius
Already Inter + `--radius: 0.75rem` (12px). Cards already use `rounded-xl` → 16px. **No changes needed** to meet the brief's "rounded 16px, modern clean font" requirement.

### Verification after build
1. Visit `/` → orange primary
2. Visit `/vendor/dashboard` → blue primary, sidebar blue, buttons blue
3. Visit `/rider/dashboard` → green primary, FAB green
4. Auth modals on each → focus rings + buttons match active theme
5. Drug reminder: query `cron.job` to confirm scheduled, run function manually to confirm dispatch

## Out of scope (call out, don't do)
- Marketing landing pages re-skin
- Hunting hardcoded hex across all 400+ files
- Splash PNG regeneration (already done in earlier turns)
- Icon assets (already per-app in `resources/`)

Ready to execute on approval.