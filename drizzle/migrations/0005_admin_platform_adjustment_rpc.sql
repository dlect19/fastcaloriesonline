CREATE OR REPLACE FUNCTION public.admin_post_platform_adjustment(
  p_amount numeric,
  p_category text,
  p_transaction_type text,
  p_reference text,
  p_notes text DEFAULT NULL,
  p_environment text DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_env text := COALESCE(p_environment, get_platform_environment());
  v_tx uuid;
  v_balance numeric;
BEGIN
  IF v_actor IS NULL OR NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  v_tx := public.post_platform_entry(
    p_amount, p_category, p_transaction_type, p_reference,
    v_env, 'completed', p_order_id, p_notes,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('posted_by', v_actor, 'source', 'admin_post_platform_adjustment')
  );

  SELECT CASE WHEN v_env = 'development' THEN COALESCE(test_balance,0) ELSE COALESCE(balance,0) END
  INTO v_balance FROM public.platform_wallet ORDER BY created_at LIMIT 1;

  INSERT INTO public.admin_sensitive_audit (
    correlation_id, actor_id, action, category, target_type, target_id, target_label,
    new_value, amount, currency, environment, reference, reason, outcome, auth_method
  ) VALUES (
    gen_random_uuid(), v_actor, 'platform_ledger_adjustment', 'financial',
    'platform_wallet', v_tx::text, p_category,
    jsonb_build_object('transaction_type', p_transaction_type, 'balance_after', v_balance),
    p_amount, 'NGN', v_env, p_reference, COALESCE(p_notes, 'Admin company ledger adjustment'),
    'success', 'admin_rpc'
  );

  RETURN jsonb_build_object('transaction_id', v_tx, 'company_balance_after', v_balance);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_post_platform_adjustment(numeric, text, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_post_platform_adjustment(numeric, text, text, text, text, text, uuid, jsonb) TO authenticated;