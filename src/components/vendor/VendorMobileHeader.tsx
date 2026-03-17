import { useNavigate } from 'react-router-dom';
import { Store, Settings, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { OutletProvider } from '@/hooks/useOutletContext';
import { OutletSwitcher } from '@/components/vendor/OutletSwitcher';

interface VendorMobileHeaderProps {
  vendorName?: string;
  vendorId?: string | null;
  onOutletChange?: (outletId: string | null) => void;
  onAddOutlet?: () => void;
}

export function VendorMobileHeader({ vendorName = 'My Restaurant', vendorId, onOutletChange, onAddOutlet }: VendorMobileHeaderProps) {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/vendor/auth');
  };

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b border-border">
      <div className="flex items-center justify-between px-3 h-14">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <Store className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm truncate">{vendorName}</span>
        </div>

        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => navigate('/vendor/promos')}>Promos</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/riders')}>My Riders</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/staff')}>Staff</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/reviews')}>Reviews</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/withdraw')}>Withdraw</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/advertising')}>Advertising</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/hours')}>Working Hours</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/vendor/store-settings')}>Store Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/vendor/settings')}>
                <Settings className="w-4 h-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Outlet switcher row */}
      {vendorId && (
        <OutletProvider vendorId={vendorId} onOutletChange={onOutletChange}>
          <div className="px-3 pb-2">
            <OutletSwitcher collapsed={false} onAddOutlet={onAddOutlet} />
          </div>
        </OutletProvider>
      )}
    </header>
  );
}
