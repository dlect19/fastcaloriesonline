import { AlertTriangle, FlaskConical, X } from 'lucide-react';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export function EnvironmentBanner() {
  const { isTestMode, isAdminTestMode, isAdmin, toggleAdminTestMode, loading, environment } = useEnvironmentConfig();
  const { user } = useAuth();

  // Don't show banner if loading or user not logged in
  if (loading || !user) {
    return null;
  }

  // Show admin test session banner when admin is in personal test mode while platform is production
  if (isAdmin && isAdminTestMode && environment === 'production') {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-purple-600 text-white py-2 px-4">
        <div className="container mx-auto flex items-center justify-center gap-2 text-sm font-medium">
          <FlaskConical className="w-4 h-4" />
          <span>ADMIN TEST SESSION - You're testing with sandbox. Real users see production.</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-6 px-2 text-white hover:bg-purple-700"
            onClick={toggleAdminTestMode}
          >
            <X className="w-3 h-3 mr-1" />
            Exit Test Mode
          </Button>
        </div>
      </div>
    );
  }

  // Show platform-wide test mode banner
  if (isTestMode && environment === 'development') {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-yellow-950 py-2 px-4">
        <div className="container mx-auto flex items-center justify-center gap-2 text-sm font-medium">
          <AlertTriangle className="w-4 h-4" />
          <span>TEST MODE - Transactions are simulated. No real money is being processed.</span>
        </div>
      </div>
    );
  }

  return null;
}
