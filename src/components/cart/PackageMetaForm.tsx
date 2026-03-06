import { useCart } from '@/hooks/useCart';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { User, StickyNote } from 'lucide-react';

interface PackageMetaFormProps {
  vendorId: string;
  packageIndex: number;
  outletId?: string;
}

export function PackageMetaForm({ vendorId, packageIndex, outletId }: PackageMetaFormProps) {
  const { packageMetas, updatePackageMeta } = useCart();
  const key = outletId ? `${vendorId}|${outletId}` : `${vendorId}|`;
  const metas = packageMetas[key] || [];
  const meta = metas[packageIndex] || { recipientName: '', note: '' };

  return (
    <div className="space-y-3 p-3 bg-secondary/30 rounded-lg border border-border">
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-primary" />
          Recipient Name
        </Label>
        <Input
          placeholder="e.g., John"
          value={meta.recipientName}
          onChange={(e) => updatePackageMeta(vendorId, packageIndex, { recipientName: e.target.value }, outletId)}
          className="h-9 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5 text-primary" />
          Package Note (optional)
        </Label>
        <Textarea
          placeholder="e.g., No pepper, extra sauce..."
          value={meta.note}
          onChange={(e) => updatePackageMeta(vendorId, packageIndex, { note: e.target.value }, outletId)}
          className="text-sm min-h-[60px] resize-none"
        />
      </div>
    </div>
  );
}
