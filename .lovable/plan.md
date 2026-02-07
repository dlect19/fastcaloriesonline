

# Fix: Infinite Loop Error + Combo UX Improvements

## Problem
The vendor menu page (`/vendor/menu`) crashes with a "Maximum update depth exceeded" error. The root cause is the **TakeawayPackManagement** component -- it's the **last remaining component** that still mounts its Dialog permanently in the DOM using the old `<Dialog open={dialogOpen}>` + `<DialogTrigger>` pattern. This triggers a known Radix UI bug where multiple Dialog `Presence` components conflict via `compose-refs`, creating an infinite re-render loop.

The combo creation interface also needs to show product images alongside names when selecting items for a combo.

---

## Plan

### 1. Fix the crash in TakeawayPackManagement
**File:** `src/components/vendor/TakeawayPackManagement.tsx`

Apply the same "conditional mounting" pattern used in the other components:
- Replace `<Dialog open={dialogOpen}>` + `<DialogTrigger>` with a plain `<Button>` that sets `dialogOpen = true`
- Only render `{dialogOpen && (<Dialog open ...>)}` so the Dialog is completely unmounted from the DOM when closed
- This eliminates the Radix compose-refs conflict that causes the infinite loop

### 2. Show product images in combo product selection
**File:** `src/components/vendor/ComboManagement.tsx`

Update the product selection list inside the combo creation form:
- Display each product's image (or a placeholder icon) next to its name in the selection list
- Show the product price beside each item for easy reference
- Keep the existing checkbox + quantity controls

---

## Technical Details

### TakeawayPackManagement fix (lines 257-266 to 394):

```text
Before (broken):
  <Dialog open={dialogOpen} onOpenChange={...}>
    <DialogTrigger asChild>
      <Button>Add Pack</Button>
    </DialogTrigger>
    <DialogContent>...</DialogContent>
  </Dialog>

After (fixed):
  <Button onClick={() => setDialogOpen(true)}>Add Pack</Button>
  {dialogOpen && (
    <Dialog open onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } }}>
      <DialogContent>...</DialogContent>
    </Dialog>
  )}
```

### ComboManagement product selection (lines 424-466):

Update the product list items to include a small product image thumbnail (40x40px) next to the product name in each selection row, making it easier for vendors to identify products visually.

