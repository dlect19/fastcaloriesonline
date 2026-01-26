import { AlertTriangle } from 'lucide-react';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useAuth } from '@/hooks/useAuth';

export function EnvironmentBanner() {
  const { isTestMode, loading } = useEnvironmentConfig();
  const { user } = useAuth();

  // Don't show banner if loading, not in test mode, or user not logged in
  if (loading || !isTestMode || !user) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-yellow-950 py-2 px-4">
      <div className="container mx-auto flex items-center justify-center gap-2 text-sm font-medium">
        <AlertTriangle className="w-4 h-4" />
        <span>TEST MODE - Transactions are simulated. No real money is being processed.</span>
      </div>
    </div>
  );
}
