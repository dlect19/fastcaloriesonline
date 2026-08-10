import { useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuestMode } from '@/hooks/useGuestMode';

/**
 * Sticky nudge shown while a visitor is browsing without an account.
 */
export function GuestBanner() {
  const navigate = useNavigate();
  const { exitGuestMode } = useGuestMode();

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20">
      <Eye className="w-5 h-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">You're browsing as a guest</p>
        <p className="text-xs text-muted-foreground">
          Create a free account to order, track calories and earn rewards.
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0 font-semibold"
        onClick={() => {
          exitGuestMode();
          navigate('/auth');
        }}
      >
        Sign up
      </Button>
    </div>
  );
}
