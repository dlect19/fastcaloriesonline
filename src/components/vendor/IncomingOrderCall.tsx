import { useState, useEffect, useCallback } from 'react';
import { Phone, PhoneOff, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface IncomingOrderCallProps {
  visible: boolean;
  orderNumber?: string;
  orderTotal?: string;
  orderId?: string;
  onAccept: () => void;
  onDismiss: () => void;
}

export function IncomingOrderCall({
  visible,
  orderNumber,
  orderTotal,
  orderId,
  onAccept,
  onDismiss,
}: IncomingOrderCallProps) {
  const navigate = useNavigate();

  const handleAccept = useCallback(() => {
    onAccept();
    navigate('/vendor/orders');
  }, [onAccept, navigate]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95"
        >
          {/* Pulsing ring animation */}
          <div className="relative mb-8">
            <motion.div
              animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-full bg-green-500/30"
              style={{ width: 160, height: 160, top: -40, left: -40 }}
            />
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              className="absolute inset-0 rounded-full bg-green-500/20"
              style={{ width: 200, height: 200, top: -60, left: -60 }}
            />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/50">
              <ShoppingBag className="h-10 w-10 text-white" />
            </div>
          </div>

          {/* Order info */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-2 text-center"
          >
            <p className="text-lg font-medium text-green-400 uppercase tracking-widest">
              Incoming Order
            </p>
          </motion.div>

          <motion.h2
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mb-1 text-3xl font-bold text-white"
          >
            {orderNumber ? `Order #${orderNumber}` : 'New Order!'}
          </motion.h2>

          {orderTotal && (
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mb-12 text-xl text-gray-300"
            >
              ₦{orderTotal}
            </motion.p>
          )}

          {/* Action buttons */}
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex items-center gap-12"
          >
            {/* Dismiss */}
            <button
              onClick={onDismiss}
              className="flex flex-col items-center gap-2"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 active:scale-95 transition-transform">
                <PhoneOff className="h-7 w-7 text-white" />
              </div>
              <span className="text-sm text-gray-400">Dismiss</span>
            </button>

            {/* Accept */}
            <button
              onClick={handleAccept}
              className="flex flex-col items-center gap-2"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/40 active:scale-95 transition-transform"
              >
                <Phone className="h-7 w-7 text-white" />
              </motion.div>
              <span className="text-sm text-gray-400">Pick Order</span>
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
