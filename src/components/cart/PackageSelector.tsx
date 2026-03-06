import { useCart } from '@/hooks/useCart';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Package, X, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PackageSelectorProps {
  vendorId: string;
  outletId?: string;
}

export function PackageSelector({ vendorId, outletId }: PackageSelectorProps) {
  const { 
    activePackageIndex, setActivePackageIndex, 
    addPackage, removePackage, getPackageCount, maxPackages,
    packageMetas, extraPackageFeePerPack,
  } = useCart();
  const { toast } = useToast();

  const key = outletId ? `${vendorId}|${outletId}` : `${vendorId}|`;
  const metas = packageMetas[key] || [{ recipientName: '', note: '' }];
  const packageCount = metas.length;

  const handleAddPackage = () => {
    const newIndex = addPackage(vendorId, outletId);
    if (newIndex === null) {
      toast({
        title: 'Package limit reached',
        description: `Maximum ${maxPackages} packages per order.`,
        variant: 'destructive',
      });
    }
  };

  const handleRemovePackage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    removePackage(vendorId, index, outletId);
  };

  if (packageCount <= 1) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Ordering for multiple people?</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
          onClick={handleAddPackage}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Package
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {packageCount} Package{packageCount > 1 ? 's' : ''}
          </span>
          <Badge variant="secondary" className="text-xs">
            +₦{((packageCount - 1) * extraPackageFeePerPack).toLocaleString()} extra delivery
          </Badge>
        </div>
        {packageCount < maxPackages && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs h-7"
            onClick={handleAddPackage}
          >
            <Plus className="w-3 h-3" />
            Add
          </Button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {metas.map((meta, index) => (
          <button
            key={index}
            onClick={() => setActivePackageIndex(index)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 border ${
              activePackageIndex === index
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
            }`}
          >
            <Package className="w-3 h-3" />
            {meta.recipientName || `Pack ${index + 1}`}
            {packageCount > 1 && (
              <span
                role="button"
                onClick={(e) => handleRemovePackage(index, e)}
                className="ml-1 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
