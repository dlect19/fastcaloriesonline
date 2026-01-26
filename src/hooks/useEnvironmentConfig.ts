import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const ADMIN_TEST_MODE_KEY = 'fc_admin_test_mode';

interface EnvironmentConfig {
  environment: 'development' | 'production';
  effectiveEnvironment: 'development' | 'production'; // Considers admin test mode
  paystackPublicKey: string;
  isTestMode: boolean;
  isAdminTestMode: boolean; // Admin's personal test session
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  toggleAdminTestMode: () => void;
  refetch: () => void;
}

export function useEnvironmentConfig(): EnvironmentConfig {
  const [platformEnvironment, setPlatformEnvironment] = useState<'development' | 'production'>('development');
  const [paystackPublicKey, setPaystackPublicKey] = useState('');
  const [isAdminTestMode, setIsAdminTestMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase.functions.invoke('get-platform-config');

      if (fetchError) {
        console.error('Error fetching platform config:', fetchError);
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setPlatformEnvironment(data.environment || 'development');
      setPaystackPublicKey(data.paystackPublicKey || '');
      setError(null);
    } catch (err) {
      console.error('Failed to fetch environment config:', err);
      setError('Failed to load environment configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  const checkAdminStatus = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const hasAdminRole = roles?.some(r => r.role === 'admin') || false;
      setIsAdmin(hasAdminRole);

      // Only load admin test mode if user is admin
      if (hasAdminRole) {
        const savedMode = localStorage.getItem(ADMIN_TEST_MODE_KEY);
        if (savedMode === 'true') {
          setIsAdminTestMode(true);
        }
      }
    } catch (err) {
      console.error('Error checking admin status:', err);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    checkAdminStatus();
  }, [fetchConfig, checkAdminStatus]);

  const toggleAdminTestMode = useCallback(() => {
    if (!isAdmin) return;
    
    const newMode = !isAdminTestMode;
    setIsAdminTestMode(newMode);
    
    if (newMode) {
      localStorage.setItem(ADMIN_TEST_MODE_KEY, 'true');
    } else {
      localStorage.removeItem(ADMIN_TEST_MODE_KEY);
    }
  }, [isAdmin, isAdminTestMode]);

  // Calculate effective environment:
  // - If platform is in development, everyone sees development
  // - If platform is in production BUT admin has test mode on, that admin sees development
  // - Otherwise, production
  const effectiveEnvironment: 'development' | 'production' = 
    platformEnvironment === 'development' 
      ? 'development' 
      : (isAdmin && isAdminTestMode) 
        ? 'development' 
        : 'production';

  const isTestMode = effectiveEnvironment === 'development';

  return {
    environment: platformEnvironment,
    effectiveEnvironment,
    paystackPublicKey: isTestMode ? (paystackPublicKey || '') : paystackPublicKey,
    isTestMode,
    isAdminTestMode,
    isAdmin,
    loading,
    error,
    toggleAdminTestMode,
    refetch: fetchConfig,
  };
}
