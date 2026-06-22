
-- Backfill: re-run adjust_vendor_payout_after_refund on every paid, non-POS
-- order that has at least one refunded item or refunded addon. The function
-- itself is idempotent — if the vendor share already matches, delta is 0 and
-- nothing changes.
DO $$
DECLARE
  r RECORD;
  v_result jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT o.id, o.order_number
      FROM orders o
     WHERE COALESCE(o.channel,'') <> 'pos'
       AND o.payment_status = 'paid'
       AND (
         EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.is_refunded = true)
         OR EXISTS (
           SELECT 1 FROM order_item_addons a
             JOIN order_items oi ON oi.id = a.order_item_id
            WHERE oi.order_id = o.id AND a.is_refunded = true
         )
       )
  LOOP
    BEGIN
      v_result := adjust_vendor_payout_after_refund(r.id);
      RAISE NOTICE 'Backfilled %: %', r.order_number, v_result;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped % due to error: %', r.order_number, SQLERRM;
    END;
  END LOOP;
END$$;
