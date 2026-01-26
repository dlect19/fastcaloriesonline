import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface EnvironmentConfig {
  environment: 'development' | 'production';
  paystackPublicKey: string;
  isTestMode: boolean;
  loading: boolean;
  error: string | null;
}

export function useEnvironmentConfig(): EnvironmentConfig {
  const [config, setConfig] = useState<EnvironmentConfig>({
    environment: 'development',
    paystackPublicKey: '',
    isTestMode: true,
    loading: true,
    error: null,
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-platform-config');

      if (error) {
        console.error('Error fetching platform config:', error);
        setConfig(prev => ({
          ...prev,
          loading: false,
          error: error.message,
        }));
        return;
      }

      setConfig({
        environment: data.environment || 'development',
        paystackPublicKey: data.paystackPublicKey || '',
        isTestMode: data.isTestMode ?? true,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Failed to fetch environment config:', err);
      setConfig(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to load environment configuration',
      }));
    }
  };

  return config;
}
