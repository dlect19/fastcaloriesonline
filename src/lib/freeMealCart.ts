import { supabase } from '@/integrations/supabase/client';
import type { CartItem } from '@/hooks/useCart';

type AddCartItem = (item: Omit<CartItem, 'id' | 'packageIndex'>, packageIndex?: number) => void;

interface AddFreeMealToCartResult {
  addedCount: number;
}

export async function addFreeMealPromoItemsToCart(
  promoId: string,
  addItem: AddCartItem
): Promise<AddFreeMealToCartResult> {
  const { data: promo, error: promoError } = await supabase
    .from('free_meal_promos')
    .select('id, vendor_id, vendor_name, outlet_id, product_id, product_name, product_image_url')
    .eq('id', promoId)
    .single();

  if (promoError || !promo) {
    throw new Error('Promo not found.');
  }

  const { data: promoItems, error: itemsError } = await supabase
    .from('free_meal_promo_items')
    .select('quantity, product_id, takeaway_pack_id, products:product_id(id, name, image_url, calories, price), takeaway_packs:takeaway_pack_id(id, name, image_url, price)')
    .eq('promo_id', promoId)
    .order('sort_order', { ascending: true });

  if (itemsError) {
    throw new Error('Could not load free meal items.');
  }

  let addedCount = 0;

  const rows = promoItems ?? [];
  if (rows.length > 0) {
    for (const row of rows) {
      const qty = Math.max(1, row.quantity ?? 1);
      const product = row.products as unknown as { id: string; name: string; image_url: string | null; calories?: number | null; price?: number | null } | null;
      const pack = row.takeaway_packs as unknown as { id: string; name: string; image_url: string | null; price?: number | null } | null;

      if (product?.id) {
        addItem({
          productId: product.id,
          productName: product.name,
          vendorId: promo.vendor_id,
          vendorName: promo.vendor_name,
          outletId: promo.outlet_id ?? undefined,
          price: 0,
          originalPrice: Number(product.price || 0),
          quantity: qty,
          calories: Number(product.calories || 0),
          imageUrl: product.image_url || promo.product_image_url || undefined,
          isFreeMeal: true,
          freeMealPromoId: promoId,
          _adminFreeQty: qty,
        });
        addedCount += qty;
        continue;
      }

      if (pack?.id) {
        addItem({
          productId: pack.id,
          productName: `${pack.name} (Free Pack)`,
          vendorId: promo.vendor_id,
          vendorName: promo.vendor_name,
          outletId: promo.outlet_id ?? undefined,
          price: 0,
          originalPrice: Number(pack.price || 0),
          quantity: qty,
          calories: 0,
          imageUrl: pack.image_url || promo.product_image_url || undefined,
          addonsDescription: 'Free meal takeaway pack',
          isFreeMeal: true,
          freeMealPromoId: promoId,
          _adminFreeQty: qty,
        });
        addedCount += qty;
      }
    }
  }

  if (addedCount === 0 && promo.product_id) {
    const { data: fallbackProduct } = await supabase
      .from('products')
      .select('name, image_url, calories, price')
      .eq('id', promo.product_id)
      .maybeSingle();

    const fallbackOriginalPrice = Number(fallbackProduct?.price || 0);

    addItem({
      productId: promo.product_id,
      productName: fallbackProduct?.name || promo.product_name,
      vendorId: promo.vendor_id,
      vendorName: promo.vendor_name,
      outletId: promo.outlet_id ?? undefined,
      price: 0,
      originalPrice: fallbackOriginalPrice,
      quantity: 1,
      calories: Number(fallbackProduct?.calories || 0),
      imageUrl: fallbackProduct?.image_url || promo.product_image_url || undefined,
      isFreeMeal: true,
      freeMealPromoId: promoId,
      _adminFreeQty: 1,
    });
    addedCount = 1;
  }

  if (addedCount === 0) {
    throw new Error('No valid free meal items configured for this promo.');
  }

  return { addedCount };
}