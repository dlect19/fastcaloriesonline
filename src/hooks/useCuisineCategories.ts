import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type CuisineCategory = Tables<'cuisine_categories'>;

export interface CuisineWithChildren extends CuisineCategory {
  children: CuisineCategory[];
}

export function useCuisineCategories() {
  const [categories, setCategories] = useState<CuisineCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('cuisine_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) setError(error.message);
    else setCategories(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const parents = categories.filter((c) => !c.parent_id);
  const grouped: CuisineWithChildren[] = parents.map((p) => ({
    ...p,
    children: categories.filter((c) => c.parent_id === p.id),
  }));

  return { categories, parents, grouped, loading, error, refetch: fetchAll };
}
