import { describe, it, expect } from 'vitest';
import { calculateItemSubtotal, CartItem } from '@/hooks/useCart';

// Regression: the app cart used to charge paid add-ons once per line, while
// the authoritative server prices selected add-ons PER UNIT of the item.
// Displayed totals then fell short of the server total and wallet checkout
// was rejected with a price-change error. Display must equal server math:
// line = (base + Σ addon.price × addon.quantity) × item.quantity.

function makeItem(overrides: Partial<CartItem>): CartItem {
  return {
    id: 'line-1',
    productId: 'prod-1',
    vendorId: 'vendor-1',
    productName: 'Jollof Rice',
    price: 0,
    quantity: 1,
    calories: 0,
    ...overrides,
  } as CartItem;
}

describe('cart add-on pricing matches server-authoritative per-unit math', () => {
  it('quantity 1: base plus each paid add-on counted once', () => {
    const item = makeItem({
      price: 1000,
      quantity: 1,
      addons: [
        { groupName: 'Extras', itemName: 'Fried Beef', price: 700, calories: 100, pricingType: 'fixed' },
        { groupName: 'Extras', itemName: 'Plantain', price: 300, calories: 80, pricingType: 'fixed' },
      ] as any,
    });
    // server: (1000 + 700 + 300) × 1 = 2000
    expect(calculateItemSubtotal(item)).toBe(2000);
  });

  it('quantity >1: paid add-ons scale with item quantity (the diagnosed bug)', () => {
    const item = makeItem({
      price: 1000,
      quantity: 4,
      addons: [
        { groupName: 'Extras', itemName: 'Fried Beef', price: 700, calories: 100, pricingType: 'fixed' },
        { groupName: 'Extras', itemName: 'Plantain', price: 300, calories: 80, pricingType: 'fixed' },
      ] as any,
    });
    // server: (1000 + 700 + 300) × 4 = 8000 (old app display: 4000 + 1000 = 5000)
    expect(calculateItemSubtotal(item)).toBe(8000);
  });

  it('per-piece add-on quantity multiplies inside each unit', () => {
    const item = makeItem({
      price: 500,
      quantity: 3,
      addons: [
        { groupName: 'Extras', itemName: 'Chicken Piece', price: 400, calories: 150, quantity: 2, pricingType: 'per_piece' },
      ] as any,
    });
    // server: (500 + 400×2) × 3 = 3900
    expect(calculateItemSubtotal(item)).toBe(3900);
  });

  it('no add-ons: unchanged base × quantity', () => {
    expect(calculateItemSubtotal(makeItem({ price: 1500, quantity: 2 }))).toBe(3000);
    expect(calculateItemSubtotal(makeItem({ price: 1500, quantity: 1, addons: [] } as any))).toBe(1500);
  });

  it('free-meal overflow keeps base discount while add-ons remain per unit', () => {
    const item = makeItem({
      price: 0,
      originalPrice: 2000,
      isFreeMeal: true,
      _adminFreeQty: 1,
      quantity: 2,
      addons: [
        { groupName: 'Extras', itemName: 'Fried Beef', price: 700, calories: 100, pricingType: 'fixed' },
      ] as any,
    });
    // 1 free + 1 paid extra at 2000, add-ons on both units: 2000 + 700×2 = 3400
    expect(calculateItemSubtotal(item)).toBe(3400);
  });
});
