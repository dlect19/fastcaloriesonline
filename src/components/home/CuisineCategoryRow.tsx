import { useNavigate } from 'react-router-dom';
import { useCuisineCategories } from '@/hooks/useCuisineCategories';
import { Skeleton } from '@/components/ui/skeleton';
import { UtensilsCrossed } from 'lucide-react';

export function CuisineCategoryRow() {
  const navigate = useNavigate();
  const { categories, loading } = useCuisineCategories();

  if (loading) {
    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-foreground">Browse by Food</h2>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-20 w-20 rounded-2xl shrink-0" />
          ))}
        </div>
      </section>
    );
  }

  // Prefer child categories (the specific dishes) for the row; fall back to parents
  const items = categories.filter((c) => c.parent_id).slice(0, 30);
  const display = items.length > 0 ? items : categories.slice(0, 30);

  if (display.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-foreground">Browse by Food</h2>
        <button
          onClick={() => navigate('/explore?view=cuisines')}
          className="text-sm font-medium text-primary hover:underline"
        >
          See all
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {display.map((cat) => (
          <button
            key={cat.id}
            onClick={() => navigate(`/explore?cuisine=${cat.id}`)}
            className="flex flex-col items-center gap-1.5 shrink-0 group"
          >
            <div className="w-20 h-20 rounded-2xl bg-secondary hover:bg-secondary/80 flex items-center justify-center text-3xl transition-all group-hover:scale-105 border border-border">
              {cat.icon || <UtensilsCrossed className="w-7 h-7 text-muted-foreground" />}
            </div>
            <span className="text-xs font-medium text-foreground max-w-[5rem] text-center truncate">
              {cat.name}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
