import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Pill, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface TrackableDrug {
  id: string;
  drug_name: string;
  doses_taken: number;
  total_doses: number;
  is_completed: boolean;
}

export function DrugTrackerButton({ className }: { className?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [drugs, setDrugs] = useState<TrackableDrug[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchDrugs = async () => {
      const { data } = await supabase
        .from('drug_usage_tracking')
        .select('id, drug_name, doses_taken, total_doses, is_completed, prescription_orders!inner(id, delivered_at)')
        .eq('user_id', user.id)
        .eq('is_completed', false)
        .not('prescription_orders.delivered_at', 'is', null)
        .order('created_at', { ascending: false });

      setDrugs((data as any) || []);
      setLoading(false);
    };

    fetchDrugs();

    // Live updates so the button disappears when the course completes
    const channel = supabase
      .channel('drug-tracker-home-button')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'drug_usage_tracking',
          filter: `user_id=eq.${user.id}`,
        },
        () => fetchDrugs()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (loading || drugs.length === 0) return null;

  const totalRemaining = drugs.reduce(
    (sum, d) => sum + (d.total_doses - d.doses_taken),
    0
  );

  return (
    <AnimatePresence>
      <motion.button
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 24 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate('/drug-tracker')}
        className={cn(
          'w-full relative overflow-hidden rounded-2xl p-3.5',
          'bg-gradient-to-r from-primary to-primary/90 text-primary-foreground',
          'shadow-lg shadow-primary/20 hover:shadow-primary/30',
          'transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className
        )}
      >
        {/* Animated background shimmer */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{
            repeat: Infinity,
            duration: 2.5,
            ease: 'easeInOut',
            repeatDelay: 1.5,
          }}
        />

        {/* Soft glowing orb */}
        <motion.div
          className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-white/20 blur-xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        <div className="relative flex items-center gap-3">
          {/* Pill icon with pulse ring */}
          <div className="relative flex-shrink-0">
            <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
            <div className="relative w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Pill className="w-5 h-5 text-primary-foreground" />
            </div>
          </div>

          <div className="flex-1 text-left min-w-0">
            <p className="font-semibold text-sm text-primary-foreground truncate">
              Track your drug usage
            </p>
            <p className="text-xs text-primary-foreground/80 truncate">
              {drugs.length === 1
                ? `${drugs[0].drug_name} — ${totalRemaining} dose${totalRemaining !== 1 ? 's' : ''} left`
                : `${drugs.length} medications — ${totalRemaining} dose${totalRemaining !== 1 ? 's' : ''} left`}
            </p>
          </div>

          <ChevronRight className="w-5 h-5 text-primary-foreground/80 flex-shrink-0" />
        </div>
      </motion.button>
    </AnimatePresence>
  );
}
