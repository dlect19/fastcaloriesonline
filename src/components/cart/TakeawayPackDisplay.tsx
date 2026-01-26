import { Package } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface TakeawayPack {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
}

interface TakeawayPackDisplayProps {
  packs: TakeawayPack[];
}

export function TakeawayPackDisplay({ packs }: TakeawayPackDisplayProps) {
  if (packs.length === 0) return null;

  const totalPackCost = packs.reduce((sum, pack) => sum + pack.price, 0);

  return (
    <Card className="p-4 border-border bg-secondary/30">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-primary" />
        <h3 className="font-medium text-sm text-foreground">Takeaway Pack (Auto-added)</h3>
      </div>
      <div className="space-y-2">
        {packs.map((pack) => (
          <div key={pack.id} className="flex items-center gap-3">
            {pack.image_url ? (
              <img
                src={pack.image_url}
                alt={pack.name}
                className="w-10 h-10 rounded-lg object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <Package className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{pack.name}</p>
              {pack.description && (
                <p className="text-xs text-muted-foreground truncate">{pack.description}</p>
              )}
            </div>
            <span className="text-sm font-semibold text-primary">
              {pack.price > 0 ? `₦${pack.price.toLocaleString()}` : 'Free'}
            </span>
          </div>
        ))}
      </div>
      {totalPackCost > 0 && packs.length > 1 && (
        <div className="mt-3 pt-2 border-t border-border flex justify-between text-sm">
          <span className="text-muted-foreground">Pack Total</span>
          <span className="font-semibold text-foreground">₦{totalPackCost.toLocaleString()}</span>
        </div>
      )}
    </Card>
  );
}
