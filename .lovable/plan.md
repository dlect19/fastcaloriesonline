

## Multi-Workspace RBAC Enhancement Plan

### Current State

Your platform already has a solid RBAC foundation with staff tables, role-based permissions, staff login pages, and sidebar tab filtering for vendors, admin, and delivery companies. This plan fills the remaining gaps.

### What Will Be Built

#### 1. Custom Per-Staff Permission Overrides
Currently, assigning a role (e.g., "Manager") gives a fixed set of tab permissions. This enhancement allows owners to override permissions per individual staff member -- for example, giving a Cashier access to the Menu tab, or removing Earnings access from a Manager.

- Store custom permission arrays in the existing `permissions` column on `vendor_staff`, `admin_staff`, and `delivery_company_staff`
- Update permission hooks to merge role defaults with per-staff overrides
- Add a permission checklist UI in the Staff Management dialog when creating or editing staff

#### 2. Human-Readable Workspace Slugs
Add a `slug` column to the `vendors` and `delivery_companies` tables so staff login links look like `/workspace/my-restaurant` instead of `/vendor/staff-login/uuid`.

- Database migration: add unique `slug` column to `vendors` and `delivery_companies`
- Auto-generate slug from business name on creation
- New route: `/workspace/:slug` that resolves the workspace type and redirects to the appropriate staff login
- Existing UUID-based URLs continue to work

#### 3. Activity Log Viewer
The `activity_logs` table already exists with proper RLS. This adds a UI for owners to view staff activity.

- New `ActivityLogViewer` component showing a filterable, paginated table of staff actions
- Integrate into vendor Staff page, delivery company Settings, and admin Staff page
- Log key actions: role changes, staff creation/removal, order processing, withdrawal requests

#### 4. Delivery Company Staff Management UI
The `delivery_company_staff` table exists but has no management interface.

- Create `DeliveryStaffManagement` component (mirroring the vendor `StaffManagement` pattern)
- Add "Staff" nav item to `DeliverySidebar`
- New page: `/delivery/staff`

---

### Technical Details

#### Database Changes (Migration)

```text
1. ALTER TABLE vendors ADD COLUMN slug TEXT UNIQUE
2. ALTER TABLE delivery_companies ADD COLUMN slug TEXT UNIQUE
3. CREATE INDEX on vendors(slug) and delivery_companies(slug)
4. Backfill slugs from existing business names
5. RLS policy: allow public SELECT on slug column (for login page resolution)
```

#### Permission Hook Changes

Update `useVendorPermissions` and `useAdminPermissions` to check the `permissions` column:
- If `permissions[]` is non-empty on the staff record, use those instead of role defaults
- If empty, fall back to role-based defaults (current behavior preserved)

#### Files to Create
- `src/pages/WorkspaceLogin.tsx` -- slug resolver page
- `src/components/shared/ActivityLogViewer.tsx` -- reusable log viewer
- `src/components/shared/PermissionChecklistDialog.tsx` -- granular permission editor
- `src/components/delivery/DeliveryStaffManagement.tsx` -- logistics staff management
- `src/pages/delivery/DeliveryStaff.tsx` -- logistics staff page

#### Files to Modify
- `src/App.tsx` -- add `/workspace/:slug` and `/delivery/staff` routes
- `src/hooks/useVendorPermissions.ts` -- merge custom permissions
- `src/hooks/useAdminPermissions.ts` -- merge custom permissions
- `src/components/vendor/StaffManagement.tsx` -- add permission checklist to create/edit dialogs
- `src/components/vendor/VendorSidebar.tsx` -- no change needed (already filters by permissions)
- `src/components/delivery/DeliverySidebar.tsx` -- add Staff nav item
- `src/pages/vendor/VendorStaff.tsx` -- add activity log tab
- `src/pages/admin/AdminStaff.tsx` -- add activity log tab

#### Activity Logging Strategy
Insert logs from existing edge functions (`create-staff-account`) and add client-side logging calls for role changes, staff activation/deactivation, and financial actions. Uses the existing `activity_logs` table.

### What Stays the Same
- All existing role definitions (owner/manager/cashier/viewer, super_admin/admin/support/analyst)
- All existing RLS policies enforcing workspace isolation
- The `create-staff-account` edge function
- Current staff login flow (UUID-based URLs still work)
- Financial protection triggers (`prevent_direct_balance_update`)

