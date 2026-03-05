import { UtensilsCrossed } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

interface CuisineCategory {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  sort_order: number;
}

interface AdminMenuProductCardProps {
  product: any;
  parentCategories: CuisineCategory[];
  getSubCategories: (parentId: string) => CuisineCategory[];
  onToggleAvailability: (productId: string, currentAvail: boolean) => void;
  onAssignCuisine: (productId: string, cuisineCategoryId: string | null) => void;
}

export function AdminMenuProductCard({
  product,
  parentCategories,
  getSubCategories,
  onToggleAvailability,
  onAssignCuisine,
}: AdminMenuProductCardProps) {
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex gap-3">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-16 h-16 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center shrink-0">
            <UtensilsCrossed className="w-6 h-6 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-sm truncate">{product.name}</h3>
            <Switch
              checked={product.is_available}
              onCheckedChange={() => onToggleAvailability(product.id, product.is_available)}
            />
          </div>
          <p className="text-sm font-semibold text-primary mt-1">
            ₦{Number(product.price).toLocaleString()}
          </p>
          {product.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
          )}
          <div className="flex gap-1 mt-2 flex-wrap">
            {!product.is_available && (
              <Badge variant="secondary" className="text-xs">Unavailable</Badge>
            )}
            {product.calories && (
              <Badge variant="outline" className="text-xs">{product.calories} cal</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Cuisine Category Assignment */}
      <Select
        value={product.cuisine_category_id || 'none'}
        onValueChange={(val) => onAssignCuisine(product.id, val)}
      >
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="Assign cuisine category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="text-muted-foreground">No cuisine category</span>
          </SelectItem>
          {parentCategories.map(parent => {
            const subs = getSubCategories(parent.id);
            if (subs.length === 0) {
              return (
                <SelectItem key={parent.id} value={parent.id}>
                  {parent.icon} {parent.name}
                </SelectItem>
              );
            }
            return (
              <SelectGroup key={parent.id}>
                <SelectLabel className="text-xs font-semibold">
                  {parent.icon} {parent.name}
                </SelectLabel>
                {subs.map(sub => (
                  <SelectItem key={sub.id} value={sub.id}>
                    {sub.icon} {sub.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
