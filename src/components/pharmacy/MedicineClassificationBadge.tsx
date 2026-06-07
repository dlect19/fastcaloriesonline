import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type MedicineClassification = 'otc' | 'prescription' | 'controlled';

interface Props {
  classification?: string | null;
  /** Compact dot-style badge for tight rows (e.g. product cards) */
  size?: 'sm' | 'md';
  className?: string;
}

const META: Record<MedicineClassification, { label: string; dot: string; cls: string }> = {
  otc: {
    label: 'OTC — No Prescription',
    dot: '🟢',
    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  },
  prescription: {
    label: 'Prescription Required',
    dot: '🟡',
    cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  },
  controlled: {
    label: 'Controlled Drug — Verification Required',
    dot: '🔴',
    cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
  },
};

export function MedicineClassificationBadge({ classification, size = 'md', className }: Props) {
  const key = (classification as MedicineClassification) || 'otc';
  const meta = META[key] || META.otc;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 font-medium shrink-0',
        size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs',
        meta.cls,
        className,
      )}
    >
      <span aria-hidden>{meta.dot}</span>
      {size === 'sm' ? (key === 'otc' ? 'OTC' : key === 'prescription' ? 'Rx' : 'Controlled') : meta.label}
    </Badge>
  );
}
