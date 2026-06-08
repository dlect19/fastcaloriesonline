import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type MedicineClassification = 'otc' | 'prescription' | 'controlled';

interface Props {
  classification?: string | null;
  /** Compact dot-style badge for tight rows (e.g. product cards) */
  size?: 'sm' | 'md';
  className?: string;
  /** Show explanatory tooltip on hover (default true) */
  showTooltip?: boolean;
}

const META: Record<MedicineClassification, { label: string; dot: string; cls: string; description: string }> = {
  otc: {
    label: 'OTC — No Prescription',
    dot: '🟢',
    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
    description: 'Over-the-counter medicine. No prescription needed.',
  },
  prescription: {
    label: 'Prescription Required',
    dot: '🟡',
    cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
    description: 'Requires a valid prescription from a doctor or pharmacist approval before dispensing.',
  },
  controlled: {
    label: 'Controlled Drug — Verification Required',
    dot: '🔴',
    cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
    description: 'Strictly regulated drug. Requires prescription + identity verification at delivery.',
  },
};

export function MedicineClassificationBadge({ classification, size = 'md', className, showTooltip = true }: Props) {
  const key = (classification as MedicineClassification) || 'otc';
  const meta = META[key] || META.otc;

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 font-medium shrink-0 cursor-help',
        size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs',
        meta.cls,
        className,
      )}
    >
      <span aria-hidden>{meta.dot}</span>
      {size === 'sm' ? (key === 'otc' ? 'OTC' : key === 'prescription' ? 'Rx' : 'Controlled') : meta.label}
    </Badge>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <p className="font-medium">{meta.label}</p>
          <p className="text-muted-foreground mt-0.5">{meta.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
