import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ProfileCompletion {
  isComplete: boolean;
  loading: boolean;
  profile: { full_name: string | null; phone: string | null } | null;
}

export function useProfileCompletion(userId: string | undefined): ProfileCompletion {
  const [isComplete, setIsComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ full_name: string | null; phone: string | null } | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const checkProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) throw error;

        setProfile(data);
        const complete = !!(data?.full_name?.trim() && data?.phone?.trim());
        setIsComplete(complete);
      } catch (error) {
        console.error('Error checking profile completion:', error);
        setIsComplete(true); // Don't block on errors
      } finally {
        setLoading(false);
      }
    };

    checkProfile();
  }, [userId]);

  return { isComplete, loading, profile };
}
