import { useState } from 'react';
import { UtensilsCrossed, Pill, ShoppingBasket } from 'lucide-react';
import { cn } from '@/lib/utils';

const categories = [
  { id: 'all', label: 'All', icon: null },
  { id: 'restaurant', label: 'Restaurants', icon: UtensilsCrossed },
  { id: 'pharmacy', label: 'Pharmacies', icon: Pill },
  { id: 'market', label: 'Markets', icon: ShoppingBasket },
];

interface CategoryPillsProps {
  onSelect?: (category: string) => void;
}

export function CategoryPills({ onSelect }: CategoryPillsProps) {
  const [selected, setSelected] = useState('all');

  const handleSelect = (id: string) => {
    setSelected(id);
    onSelect?.(id);
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {categories.map((category) => {
        const Icon = category.icon;
        const isActive = selected === category.id;

        return (
          <button
            key={category.id}
            onClick={() => handleSelect(category.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-full whitespace-nowrap transition-all shrink-0',
              isActive
                ? 'bg-primary text-primary-foreground shadow-button'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            )}
          >
            {Icon && <Icon className="w-4 h-4" />}
            <span className="text-sm font-medium">{category.label}</span>
          </button>
        );
      })}
    </div>
  );
}
