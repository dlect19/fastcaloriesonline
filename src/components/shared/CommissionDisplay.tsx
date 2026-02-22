import { Badge } from '@/components/ui/badge';
import { useCommissionInfo } from '@/hooks/useCommissionInfo';
import { Loader2, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CommissionDisplayProps {
  entityType: 'vendor' | 'rider' | 'logistics';
  entityId: string | null;
  className?: string;
}

export function CommissionDisplay({ entityType, entityId, className }: CommissionDisplayProps) {
  const { rate, source, type, loading } = useCommissionInfo(entityType, entityId);

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-help">
              <span className="text-sm text-muted-foreground">Your Commission:</span>
              <span className="text-sm font-semibold text-foreground">
                {type === 'fixed' ? `₦${rate.toLocaleString()}` : `${rate}%`}
              </span>
              <Badge variant="outline" className="text-xs">
                {source === 'custom_override' ? 'Custom' : 'Default'}
              </Badge>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              {source === 'custom_override'
                ? 'A custom commission rate has been set for your account by the admin.'
                : 'This is the platform default commission rate. Contact admin for custom rates.'}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
