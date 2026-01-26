import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AdminTestModeState {
  isAdminTestMode: boolean;
  isAdmin: boolean;
  loading: boolean;
  toggleTestMode: () => void;
}

const ADMIN_TEST_MODE_KEY = 'fc_admin_test_mode';

export function useAdminTestMode(): AdminTestModeState {
  const [isAdminTestMode, setIsAdminTestMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAdminStatus();
    
    // Load saved test mode preference
    const savedMode = localStorage.getItem(ADMIN_TEST_MODE_KEY);
    if (savedMode === 'true') {
      setIsAdminTestMode(true);
    }
  }, []);

  const checkAdminStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Check if user has admin role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const hasAdminRole = roles?.some(r => r.role === 'admin') || false;
      setIsAdmin(hasAdminRole);
    } catch (error) {
      console.error('Error checking admin status:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTestMode = useCallback(() => {
    if (!isAdmin) return;
    
    const newMode = !isAdminTestMode;
    setIsAdminTestMode(newMode);
    
    if (newMode) {
      localStorage.setItem(ADMIN_TEST_MODE_KEY, 'true');
    } else {
      localStorage.removeItem(ADMIN_TEST_MODE_KEY);
    }
  }, [isAdmin, isAdminTestMode]);

  return {
    isAdminTestMode,
    isAdmin,
    loading,
    toggleTestMode,
  };
}
