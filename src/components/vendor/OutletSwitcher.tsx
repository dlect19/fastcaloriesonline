import { Store, ChevronDown, Plus, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { useOutletContext } from '@/hooks/useOutletContext';
import { useOutletPendingCounts } from '@/hooks/useOutletPendingCounts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface OutletSwitcherProps {
  collapsed?: boolean;
  onAddOutlet?: () => void;
}

export function OutletSwitcher({ collapsed, onAddOutlet }: OutletSwitcherProps) {
  const { outlets, selectedOutlet, setSelectedOutletId } = useOutletContext();
  const vendorId = outlets[0]?.vendor_id ?? null;
  const pendingCounts = useOutletPendingCounts(vendorId);

  // Sum of pending orders in OTHER outlets (not currently selected)
  const otherOutletsPending = outlets.reduce((sum, o) => {
    if (o.id === selectedOutlet?.id) return sum;
    return sum + (pendingCounts[o.id] || 0);
  }, 0);

  if (outlets.length <= 1 && !onAddOutlet) return null;

  const getStatusIcon = (outlet: typeof outlets[0]) => {
    if (!outlet.is_approved) return <Clock className="w-3 h-3 text-warning" />;
    if (!outlet.is_active) return <AlertTriangle className="w-3 h-3 text-destructive" />;
    return <CheckCircle className="w-3 h-3 text-success" />;
  };

  const renderOutletBadge = (outletId: string) => {
    const count = pendingCounts[outletId] || 0;
    if (count === 0) return null;
    return (
      <Badge
        variant="destructive"
        className="text-[10px] px-1.5 py-0 h-5 min-w-[20px] flex items-center justify-center animate-pulse"
      >
        {count > 9 ? '9+' : count}
      </Badge>
    );
  };

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="relative w-full flex items-center justify-center px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
            <Store className="w-5 h-5 text-primary" />
            {otherOutletsPending > 0 && (
              <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-64">
          {outlets.map(outlet => (
            <DropdownMenuItem
              key={outlet.id}
              onClick={() => setSelectedOutletId(outlet.id)}
              className={cn(
                'flex items-center gap-2',
                outlet.id === selectedOutlet?.id && 'bg-primary/10'
              )}
            >
              {getStatusIcon(outlet)}
              <span className="flex-1 truncate">{outlet.outlet_name} – {outlet.outlet_surname}</span>
              {renderOutletBadge(outlet.id)}
            </DropdownMenuItem>
          ))}
          {onAddOutlet && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onAddOutlet} className="text-primary">
                <Plus className="w-4 h-4 mr-2" />
                Add Outlet
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left">
          <Store className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Active Outlet</p>
            <p className="text-sm font-semibold truncate">
              {selectedOutlet?.outlet_name || 'Select Outlet'}
              {selectedOutlet?.outlet_surname ? ` – ${selectedOutlet.outlet_surname}` : ''}
            </p>
          </div>
          {otherOutletsPending > 0 && (
            <Badge
              variant="destructive"
              className="text-[10px] px-1.5 py-0 h-5 min-w-[20px] flex items-center justify-center animate-pulse"
              title={`${otherOutletsPending} new order(s) in other outlets`}
            >
              {otherOutletsPending > 9 ? '9+' : otherOutletsPending}
            </Badge>
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {outlets.map(outlet => (
          <DropdownMenuItem
            key={outlet.id}
            onClick={() => setSelectedOutletId(outlet.id)}
            className={cn(
              'flex items-center gap-2',
              outlet.id === selectedOutlet?.id && 'bg-primary/10'
            )}
          >
            {getStatusIcon(outlet)}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {outlet.outlet_name}{outlet.outlet_surname ? ` – ${outlet.outlet_surname}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">{outlet.outlet_code}</p>
            </div>
            {renderOutletBadge(outlet.id)}
            {!outlet.is_approved && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-warning text-warning">
                Pending
              </Badge>
            )}
          </DropdownMenuItem>
        ))}
        {onAddOutlet && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onAddOutlet} className="text-primary font-medium">
              <Plus className="w-4 h-4 mr-2" />
              Add Outlet
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
