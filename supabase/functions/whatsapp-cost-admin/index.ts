// Admin-only WhatsApp AI cost accounting: dashboard aggregates, settings and
// rate-card writes (audited), and the cost simulator.
//
// Reads and writes only cost-accounting tables plus the whatsapp_* platform
// settings. It never touches orders, wallets, payouts or historical accounting.
import {
  authenticateAdmin,
  AuditTrail,
  corsHeaders,
  HttpError,
  jsonResponse,
  requestMeta,
  serviceClient,
} from "../_shared/adminGuard.ts";
import {
  parseCostConfig,
  simulateCost,
  WHATSAPP_COST_SETTING_KEYS,
} from "../_shared/whatsappCostMath.ts";

const NUMERIC_KEYS = new Set(WHATSAPP_COST_SETTING_KEYS.filter((k) =>
  !k.endsWith("_enabled") &&
  !["whatsapp_cost_charge_scope", "whatsapp_cost_pricing_method", "whatsapp_cost_fx_source",
    "whatsapp_cost_meta_country", "whatsapp_cost_config_version", "whatsapp_cost_absorb_guest_browsing"]
    .includes(k)
));

function validateSetting(key: string, value: unknown): string {
  if (!WHATSAPP_COST_SETTING_KEYS.includes(key)) throw new HttpError(`Unsupported setting: ${key}`, 400);
  const raw = String(value ?? "").trim();
  if (key.endsWith("_enabled") || key === "whatsapp_cost_absorb_guest_browsing") {
    if (!["true", "false"].includes(raw)) throw new HttpError(`${key} must be true or false`, 400);
    return raw;
  }
  if (key === "whatsapp_cost_charge_scope") {
    if (!["per_conversation", "per_response", "allocate_to_order"].includes(raw)) {
      throw new HttpError("Invalid charge scope", 400);
    }
    return raw;
  }
  if (key === "whatsapp_cost_pricing_method") {
    if (!["cost_plus", "fixed_markup"].includes(raw)) throw new HttpError("Invalid pricing method", 400);
    return raw;
  }
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(`${key} must be a non-negative number`, 400);
    return String(n);
  }
  if (!raw) throw new HttpError(`${key} cannot be empty`, 400);
  return raw.slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = serviceClient();
  const meta = requestMeta(req);
  try {
    const caller = await authenticateAdmin(req, svc);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "summary");

    // ---------------------------------------------------------------- reads
    if (action === "summary") {
      const days = Math.min(180, Math.max(1, Number(body.rangeDays || 30)));
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      const [{ data: events }, { data: quotes }, { data: settings }, { data: cards }] = await Promise.all([
        svc.from("whatsapp_usage_events")
          .select("id, event_kind, direction, message_category, window_state, model_id, provider, cost_status, billing_status, cost_usd_micros, cost_ngn_kobo, billed_ngn_kobo, subsidy_ngn_kobo, markup_ngn_kobo, input_tokens, output_tokens, thinking_tokens, cached_input_tokens, transcription_seconds, order_id, session_id, environment, created_at, finalized_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
        svc.from("whatsapp_cost_quotes")
          .select("id, status, billing_mode, customer_fee_ngn_kobo, raw_cost_ngn_kobo, subsidy_ngn_kobo, consumed_order_id, created_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
        svc.from("platform_settings").select("key, value").in("key", WHATSAPP_COST_SETTING_KEYS),
        svc.from("whatsapp_ai_rate_cards").select("*").order("effective_from", { ascending: false }).limit(50),
      ]);

      return jsonResponse({
        ok: true,
        range_days: days,
        config: parseCostConfig(settings as any),
        settings: settings ?? [],
        rate_cards: cards ?? [],
        events: events ?? [],
        quotes: quotes ?? [],
      });
    }

    // -------------------------------------------------------------- simulate
    if (action === "simulate") {
      const { data: settings } = await svc.from("platform_settings")
        .select("key, value").in("key", WHATSAPP_COST_SETTING_KEYS);
      const cfg = parseCostConfig(settings as any);
      const { data: card } = await svc.from("whatsapp_ai_rate_cards")
        .select("*").eq("model_id", String(body.model_id || "google/gemini-3.8-flash"))
        .order("is_confirmed", { ascending: false }).order("effective_from", { ascending: false })
        .limit(1).maybeSingle();
      return jsonResponse({
        ok: true,
        result: simulateCost({
          cfg: body.fx_override ? { ...cfg, fxUsdNgn: Number(body.fx_override) } : cfg,
          card: card ?? null,
          inboundMessages: Number(body.inbound_messages || 0),
          outboundMessages: Number(body.outbound_messages || 0),
          failedMessages: Number(body.failed_messages || 0),
          templateMessages: Number(body.template_messages || 0),
          templateCategory: ["service", "utility", "authentication", "marketing"]
            .includes(body.template_category) ? body.template_category : "utility",
          windowState: body.window_state === "out_of_window" ? "out_of_window" : "in_window",
          aiInputTokens: Number(body.ai_input_tokens || 0),
          aiOutputTokens: Number(body.ai_output_tokens || 0),
          aiThinkingTokens: Number(body.ai_thinking_tokens || 0),
          aiCachedInputTokens: Number(body.ai_cached_input_tokens || 0),
          voiceSeconds: Number(body.voice_minutes || 0) * 60,
          orderValueNgn: Number(body.order_value_ngn || 0),
          existingServiceFeeNgn: Number(body.existing_service_fee_ngn || 0),
        }),
      });
    }

    // ---------------------------------------------------------------- writes
    const audit = new AuditTrail(svc, caller, meta);

    if (action === "update_settings") {
      const updates = body.updates;
      if (!updates || typeof updates !== "object") throw new HttpError("updates object required", 400);
      const keys = Object.keys(updates);
      if (!keys.length) throw new HttpError("No settings supplied", 400);

      const { data: current } = await svc.from("platform_settings").select("key, value").in("key", keys);
      const before: Record<string, string | null> = {};
      (current ?? []).forEach((r: any) => { before[r.key] = r.value; });

      const clean: Record<string, string> = {};
      for (const k of keys) clean[k] = validateSetting(k, (updates as any)[k]);

      const entry = {
        action: "whatsapp_cost_settings_update",
        category: "configuration" as const,
        targetType: "platform_setting",
        targetId: "whatsapp_cost",
        targetLabel: keys.join(","),
        oldValue: before,
        newValue: clean,
        reason: body.reason ?? null,
      };
      await audit.begin(entry);

      for (const [key, value] of Object.entries(clean)) {
        const exists = Object.prototype.hasOwnProperty.call(before, key);
        const payload = { key, value, updated_at: new Date().toISOString() } as any;
        const { error } = exists
          ? await svc.from("platform_settings").update(payload).eq("key", key)
          : await svc.from("platform_settings").insert(payload);
        if (error) throw new HttpError(error.message, 400);
      }

      await audit.success(entry);
      return jsonResponse({ ok: true, updated: clean });
    }

    if (action === "upsert_rate_card") {
      const card = body.card;
      if (!card?.model_id) throw new HttpError("model_id required", 400);
      const row = {
        model_id: String(card.model_id).slice(0, 120),
        provider: String(card.provider || "lovable_gateway").slice(0, 60),
        effective_from: card.effective_from || new Date().toISOString(),
        input_usd_per_mtok: Number(card.input_usd_per_mtok || 0),
        output_usd_per_mtok: Number(card.output_usd_per_mtok || 0),
        thinking_usd_per_mtok: Number(card.thinking_usd_per_mtok || 0),
        cached_input_usd_per_mtok: Number(card.cached_input_usd_per_mtok || 0),
        audio_usd_per_mtok: Number(card.audio_usd_per_mtok || 0),
        audio_usd_per_minute: Number(card.audio_usd_per_minute || 0),
        rate_source: String(card.rate_source || "admin_entered").slice(0, 120),
        is_confirmed: card.is_confirmed === true,
        notes: card.notes ? String(card.notes).slice(0, 500) : null,
      };
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) {
          throw new HttpError(`${k} must be a non-negative number`, 400);
        }
      }

      const entry = {
        action: "whatsapp_cost_rate_card_upsert",
        category: "configuration" as const,
        targetType: "whatsapp_ai_rate_card",
        targetId: row.model_id,
        targetLabel: `${row.model_id} @ ${row.effective_from}`,
        oldValue: null,
        newValue: row,
        reason: body.reason ?? null,
      };
      await audit.begin(entry);
      const { error } = await svc.from("whatsapp_ai_rate_cards")
        .upsert(row, { onConflict: "model_id,provider,effective_from" });
      if (error) throw new HttpError(error.message, 400);
      await audit.success(entry);
      return jsonResponse({ ok: true, card: row });
    }

    throw new HttpError(`Unknown action: ${action}`, 400);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("whatsapp-cost-admin error:", msg);
    return jsonResponse({ error: msg }, status);
  }
});
