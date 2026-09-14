ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS orders_tracking_token_idx ON public.orders(tracking_token);
CREATE OR REPLACE FUNCTION public.get_public_order_tracking(_order_number text)
RETURNS TABLE(order_number text, status public.order_status, delivery_type text, vendor_name text, rider_first_name text, estimated_delivery_at timestamptz, delivered_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT o.order_number,o.status,o.delivery_type,v.name,
 CASE WHEN o.delivery_type='delivery' THEN split_part(p.full_name,' ',1) END,
 o.estimated_delivery_at,o.delivered_at,o.created_at
 FROM public.orders o LEFT JOIN public.vendors v ON v.id=o.vendor_id
 LEFT JOIN public.profiles p ON p.user_id=o.rider_id
 WHERE o.tracking_token::text=_order_number OR (o.order_number=_order_number AND o.user_id=auth.uid()) LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.get_secure_order_tracking(p_token uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('order_number',o.order_number,'status',o.status,'delivery_type',o.delivery_type,'vendor_name',v.name,'estimated_delivery_at',o.estimated_delivery_at,'delivered_at',o.delivered_at,
 'rider',CASE WHEN o.delivery_type='delivery' AND o.rider_id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('first_name',nullif(split_part(p.full_name,' ',1),''),'vehicle_type',r.vehicle_type)) END,
 'location',CASE WHEN o.delivery_type='delivery' AND o.status IN ('picked_up','on_the_way') AND r.current_latitude IS NOT NULL AND r.current_longitude IS NOT NULL AND r.updated_at>now()-interval '5 minutes' THEN jsonb_build_object('latitude',r.current_latitude,'longitude',r.current_longitude,'updated_at',r.updated_at) END))
 FROM public.orders o LEFT JOIN public.vendors v ON v.id=o.vendor_id LEFT JOIN public.profiles p ON p.user_id=o.rider_id LEFT JOIN public.rider_profiles r ON r.user_id=o.rider_id WHERE o.tracking_token=p_token LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_secure_order_tracking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_secure_order_tracking(uuid) TO anon,authenticated,service_role;
CREATE TABLE public.whatsapp_delivery_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_token uuid NOT NULL DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id), event_key text NOT NULL, status text NOT NULL,
 rider_id uuid, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','blocked','superseded')),
 provider_sid text, failure_reason text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(order_id,event_key)
);
GRANT ALL ON public.whatsapp_delivery_events TO service_role;
ALTER TABLE public.whatsapp_delivery_events ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_delivery_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ev public.whatsapp_delivery_events; k text;
BEGIN
 IF NEW.channel IS DISTINCT FROM 'whatsapp' OR NEW.delivery_type IS DISTINCT FROM 'delivery' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.rider_id IS NOT DISTINCT FROM OLD.rider_id THEN RETURN NEW; END IF;
 IF NEW.status::text NOT IN ('confirmed','preparing','ready_for_pickup','searching_for_rider','assigned','picked_up','on_the_way','delivered','cancelled') THEN RETURN NEW; END IF;
 k:=NEW.status::text;
 IF NEW.rider_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.rider_id IS DISTINCT FROM OLD.rider_id OR NEW.status='assigned') THEN k:='assigned:'||NEW.rider_id::text; END IF;
 INSERT INTO public.whatsapp_delivery_events(order_id,event_key,status,rider_id) VALUES(NEW.id,k,NEW.status::text,NEW.rider_id) ON CONFLICT(order_id,event_key) DO NOTHING RETURNING * INTO ev;
 IF ev.id IS NOT NULL THEN
 PERFORM net.http_post(url:='https://yrfbvuiinvytlvouzyxv.supabase.co/functions/v1/whatsapp-delivery-update',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('event_id',ev.id,'dispatch_token',ev.dispatch_token));
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER whatsapp_delivery_event AFTER INSERT OR UPDATE OF status,rider_id ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enqueue_whatsapp_delivery_event();