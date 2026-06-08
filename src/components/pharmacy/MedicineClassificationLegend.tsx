import { Info } from 'lucide-react';

export type MedicineClassification = 'otc' | 'prescription' | 'controlled';

const LEGEND: { key: MedicineClassification; dot: string; title: string; desc: string; border: string; bg: string }[] = [
  {
    key: 'otc',
    dot: '🟢',
    title: 'OTC',
    desc: 'Over-the-counter. No prescription required.',
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
  },
  {
    key: 'prescription',
    dot: '🟡',
    title: 'Rx',
    desc: 'Prescription required from a doctor or pharmacist approval.',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
  },
  {
    key: 'controlled',
    dot: '🔴',
    title: 'Controlled',
    desc: 'Strictly regulated. Prescription + ID verification at delivery.',
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
  },
];

interface Props {
  className?: string;
}

export function MedicineClassificationLegend({ className }: Props) {
  return (
    <div className={`rounded-lg border border-border bg-card p-3 space-y-2 ${className || ''}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5" />
        <span className="font-medium">Medicine type guide</span>
      </div>
      <div className="grid gap-1.5">
        {LEGEND.map(item => (
          <div
            key={item.key}
            className={`flex items-start gap-2 rounded-md border ${item.border} ${item.bg} px-2 py-1.5`}
          >
            <span className="text-sm leading-none mt-0.5 shrink-0" aria-hidden>{item.dot}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{item.title}</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
