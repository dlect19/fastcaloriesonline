import { useNavigate } from 'react-router-dom';
import { useFreeMealPromos } from '@/hooks/useFreeMealPromos';
import { Gift, ChevronRight, Utensils } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function FreeMealBanner() {
  const navigate = useNavigate();
  const { promos, hasAvailableFreeMeal, hasActivePromos, loading } = useFreeMealPromos();

  if (loading || !hasActivePromos) return null;

  // Find the best promo to highlight
  const redeemablePromo = promos.find(p => p.can_redeem);
  const bestPromo = redeemablePromo || promos[0];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="cursor-pointer"
        onClick={() => navigate('/free-meals')}
      >
        <div className={`relative overflow-hidden rounded-2xl border ${
          hasAvailableFreeMeal
            ? 'bg-gradient-to-r from-green-500/15 via-emerald-500/10 to-teal-500/15 border-green-500/30'
            : 'bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 border-primary/20'
        }`}>
          {/* Animated background particles */}
          {hasAvailableFreeMeal && (
            <>
              <div className="absolute top-1 right-4 text-2xl animate-bounce opacity-70">🍽️</div>
              <div className="absolute bottom-1 right-12 text-lg animate-bounce opacity-50" style={{ animationDelay: '0.3s' }}>✨</div>
            </>
          )}

          <div className="relative p-4 flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              hasAvailableFreeMeal
                ? 'bg-green-500/20'
                : 'bg-primary/20'
            }`}>
              {hasAvailableFreeMeal ? (
                <Gift className="w-6 h-6 text-green-600" />
              ) : (
                <Utensils className="w-6 h-6 text-primary" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              {hasAvailableFreeMeal ? (
                <>
                  <p className="font-bold text-green-700 dark:text-green-400 text-sm">
                    🎉 You have a FREE meal ready!
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {redeemablePromo?.product_name} worth ₦{redeemablePromo?.meal_value.toLocaleString()} — Tap to claim
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-foreground text-sm">
                    🍛 Free Meal Promo!
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Order ₦{bestPromo.order_threshold.toLocaleString()}+ to unlock a free ₦{bestPromo.meal_value.toLocaleString()} meal
                  </p>
                </>
              )}
            </div>

            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
