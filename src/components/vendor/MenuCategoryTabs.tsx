import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type ProductCategory = Tables<'product_categories'>;

interface MenuCategoryTabsProps {
  categories: ProductCategory[];
  selectedCategory: string;
  onSelect: (categoryId: string) => void;
}

export function MenuCategoryTabs({ categories, selectedCategory, onSelect }: MenuCategoryTabsProps) {
  return (
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="container flex gap-2 py-3">
          <button
            onClick={() => onSelect('all')}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition-all shrink-0',
              selectedCategory === 'all'
                ? 'bg-primary text-primary-foreground shadow-button'
                : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
            )}
          >
            All Items
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => onSelect(category.id)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-all shrink-0',
                selectedCategory === category.id
                  ? 'bg-primary text-primary-foreground shadow-button'
                  : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="invisible" />
      </ScrollArea>
    </div>
  );
}
