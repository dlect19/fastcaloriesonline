import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Ruler } from 'lucide-react';

export interface PortionDraft {
  id?: string;
  label: string;
  portion_size: string;
  price: string;
  calorie_multiplier: string;
  is_available: boolean;
}

export const PORTION_UNIT_OPTIONS = [
  { value: 'plate', label: 'Plate' },
  { value: 'litre', label: 'Litre' },
  { value: 'bowl', label: 'Bowl' },
  { value: 'pack', label: 'Pack' },
  { value: 'kg', label: 'Kilogram' },
  { value: 'piece', label: 'Piece' },
];

interface Props {
  portionUnit: string;
  onPortionUnitChange: (unit: string) => void;
  basePortionSize: string;
  onBasePortionSizeChange: (size: string) => void;
  portions: PortionDraft[];
  onChange: (portions: PortionDraft[]) => void;
  basePrice: string;
  baseCalories: string;
}

export function ProductPortionsEditor({
  portionUnit,
  onPortionUnitChange,
  basePortionSize,
  onBasePortionSizeChange,
  portions,
  onChange,
  basePrice,
  baseCalories,
}: Props) {
  const unitLabel = PORTION_UNIT_OPTIONS.find(o => o.value === portionUnit)?.label.toLowerCase() || portionUnit;

  const update = (index: number, patch: Partial<PortionDraft>) => {
    onChange(portions.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const addRow = () => {
    const nextSize = (portions.length + 1).toString();
    onChange([
      ...portions,
      {
        label: `${nextSize} ${unitLabel}${Number(nextSize) > 1 ? 's' : ''}`,
        portion_size: nextSize,
        price: '',
        calorie_multiplier: '',
        is_available: true,
      },
    ]);
  };

  const base = Math.max(Number(basePortionSize) || 1, 0.0001);
  const cals = Number(baseCalories) || 0;

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5">
        <Ruler className="w-4 h-4 text-primary" />
        <Label className="text-xs font-semibold uppercase tracking-wide text-primary">
          Portion / Size Options
        </Label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Sell the same food in different sizes (e.g. per litre). Customers pick a size and see that
        size's price and calories.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Measured in</Label>
          <Select value={portionUnit} onValueChange={onPortionUnitChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PORTION_UNIT_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Base size ({unitLabel})</Label>
          <Input
            className="h-9"
            type="number"
            step="0.1"
            min="0.1"
            value={basePortionSize}
            onChange={e => onBasePortionSizeChange(e.target.value)}
            placeholder="1"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Base size is what the main price (₦{Number(basePrice) || 0}) and calories ({cals} cal) refer to.
      </p>

      {portions.length > 0 && (
        <div className="space-y-2">
          {portions.map((p, i) => {
            const size = Number(p.portion_size) || 0;
            const mult = p.calorie_multiplier ? Number(p.calorie_multiplier) : size / base;
            const estCals = Math.round(cals * (isFinite(mult) ? mult : 0));
            return (
              <div key={i} className="rounded-lg border bg-background p-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Label</Label>
                    <Input
                      className="h-9"
                      value={p.label}
                      onChange={e => update(i, { label: e.target.value })}
                      placeholder={`2 ${unitLabel}s`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">
                      Size ({unitLabel})
                    </Label>
                    <Input
                      className="h-9"
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={p.portion_size}
                      onChange={e => update(i, { portion_size: e.target.value })}
                      placeholder="2"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Price (₦)</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      value={p.price}
                      onChange={e => update(i, { price: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">
                      Calorie × (optional)
                    </Label>
                    <Input
                      className="h-9"
                      type="number"
                      step="0.1"
                      min="0"
                      value={p.calorie_multiplier}
                      onChange={e => update(i, { calorie_multiplier: e.target.value })}
                      placeholder={(size / base || 1).toFixed(1)}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">≈ {estCals} cal</span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={p.is_available}
                        onCheckedChange={v => update(i, { is_available: v })}
                      />
                      <span className="text-[11px] text-muted-foreground">Available</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => onChange(portions.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" className="w-full" onClick={addRow}>
        <Plus className="w-4 h-4 mr-1" /> Add size option
      </Button>
    </div>
  );
}
