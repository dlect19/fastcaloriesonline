
DELETE FROM public.wallet_transactions
 WHERE category = 'voucher_sale'
   AND wallet_id = '47f10bd0-4dce-4783-b974-0a3a0c884880';
DELETE FROM public.payout_pending_releases
 WHERE wallet_id = '47f10bd0-4dce-4783-b974-0a3a0c884880'
   AND category = 'voucher_sale';

UPDATE public.wallets SET
  test_menu_earnings_pending = 0,
  test_pending_balance = 0,
  total_earned = 0
WHERE id = '47f10bd0-4dce-4783-b974-0a3a0c884880';

SELECT public.credit_vendor_wallet_for_voucher('06925c93-8229-4f8d-8d63-95786d58cee8');
SELECT public.credit_vendor_wallet_for_voucher('69c70ae3-e76e-4105-ade2-d325b3baea5d');
