import { Store, ChevronDown, Plus, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { useOutletContext } from '@/hooks/useOutletContext';
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

  if (outlets.length <= 1 && !onAddOutlet) return null;

  const getStatusIcon = (outlet: typeof outlets[0]) => {
    if (!outlet.is_approved) return <Clock className="w-3 h-3 text-warning" />;
    if (!outlet.is_active) return <AlertTriangle className="w-3 h-3 text-destructive" />;
    return <CheckCircle className="w-3 h-3 text-success" />;
  };

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center justify-center px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
            <Store className="w-5 h-5 text-primary" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
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
              <span className="truncate">{outlet.outlet_name} – {outlet.outlet_surname}</span>
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
        <button className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left">
          <Store className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Active Outlet</p>
            <p className="text-sm font-semibold truncate">
              {selectedOutlet?.outlet_name || 'Select Outlet'}
              {selectedOutlet?.outlet_surname ? ` – ${selectedOutlet.outlet_surname}` : ''}
            </p>
          </div>
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
