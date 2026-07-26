import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VoucherCategory {
  id: string;
  vendor_id: string;
  name: string;
  validity_days: number;
  is_active: boolean;
  created_at: string;
  location_id: string;
  description?: string | null;
}

export interface VoucherLocation {
  id: string;
  vendor_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export function useVoucherLocations(vendorId: string | null) {
  const [locations, setLocations] = useState<VoucherLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!vendorId) { setLocations([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from('voucher_locations')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    setLocations((data || []) as VoucherLocation[]);
    setLoading(false);
  }, [vendorId]);

  useEffect(() => { refetch(); }, [refetch]);
  return { locations, loading, refetch };
}

export interface VoucherCode {
  id: string;
  category_id: string;
  code: string;
  value: number;
  status: 'available' | 'sold' | 'expired';
  sold_at: string | null;
  created_at: string;
}

export interface VendorTemplate {
  id?: string;
  vendor_id: string;
  logo_url: string | null;
  background_color: string | null;
  background_image_url: string | null;
}

export function useVoucherCategories(vendorId: string | null) {
  const [categories, setCategories] = useState<VoucherCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!vendorId) { setCategories([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('voucher_categories')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });
    setCategories((data || []) as VoucherCategory[]);
    setLoading(false);
  }, [vendorId]);

  useEffect(() => { refetch(); }, [refetch]);
  return { categories, loading, refetch };
}

export function useVoucherCodes(categoryId: string | null) {
  const [codes, setCodes] = useState<VoucherCode[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!categoryId) { setCodes([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('voucher_codes')
      .select('*')
      .eq('category_id', categoryId)
      .order('created_at', { ascending: false });
    setCodes((data || []) as VoucherCode[]);
    setLoading(false);
  }, [categoryId]);

  useEffect(() => { refetch(); }, [refetch]);
  return { codes, loading, refetch };
}

export function useVendorTemplate(vendorId: string | null) {
  const [template, setTemplate] = useState<VendorTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!vendorId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('vendor_templates')
      .select('*')
      .eq('vendor_id', vendorId)
      .maybeSingle();
    setTemplate((data as VendorTemplate) ?? { vendor_id: vendorId, logo_url: null, background_color: '#0F172A', background_image_url: null });
    setLoading(false);
  }, [vendorId]);

  useEffect(() => { refetch(); }, [refetch]);
  return { template, loading, refetch, setTemplate };
}
