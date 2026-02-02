import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface DeliveryCompany {
  id: string;
  user_id: string;
  name: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  commission_rate: number;
  is_verified: boolean;
  is_active: boolean;
  is_email_verified: boolean;
  bank_account_number: string | null;
  bank_code: string | null;
  bank_name: string | null;
  paystack_recipient_code: string | null;
  created_at: string;
  updated_at: string;
}

interface UseDeliveryCompanyResult {
  company: DeliveryCompany | null;
  loading: boolean;
  isOwner: boolean;
  isVerified: boolean;
  isEmailVerified: boolean;
  refetch: () => Promise<void>;
}

export function useDeliveryCompany(): UseDeliveryCompanyResult {
  const { user } = useAuth();
  const [company, setCompany] = useState<DeliveryCompany | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCompany = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Check if user owns a delivery company
      const { data: ownedCompany } = await supabase
        .from('delivery_companies')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (ownedCompany) {
        setCompany(ownedCompany);
      } else {
        // Check if user is staff of any delivery company
        const { data: staffRecord } = await supabase
          .from('delivery_company_staff')
          .select('delivery_company_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          const { data: staffCompany } = await supabase
            .from('delivery_companies')
            .select('*')
            .eq('id', staffRecord.delivery_company_id)
            .single();
          setCompany(staffCompany);
        }
      }
    } catch (error) {
      console.error('Error fetching delivery company:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompany();
  }, [user]);

  const isOwner = company?.user_id === user?.id;
  const isVerified = company?.is_verified ?? false;
  const isEmailVerified = company?.is_email_verified ?? false;

  return {
    company,
    loading,
    isOwner,
    isVerified,
    isEmailVerified,
    refetch: fetchCompany,
  };
}
