import { Phone, MessageCircle, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCall } from '@/components/call/CallProvider';
import { logExternalCall } from '@/hooks/useZegoCall';
import { useAuth } from '@/hooks/useAuth';
import { canCall, isTerminalStatus, type OrderStatus } from '@/lib/callPermissions';

type Role = 'customer' | 'vendor' | 'rider';

interface Props {
  orderId: string;
  peerUserId: string | null;
  peerPhone?: string | null;
  peerName?: string;
  myRole: Role;
  peerRole: Role;
  /** Current order status — drives which contact channels are available. */
  orderStatus?: OrderStatus | null;
  compact?: boolean;
}

export function CommButtons({ orderId, peerUserId, peerPhone, peerName, myRole, peerRole, orderStatus, compact }: Props) {
  const { startCall } = useCall();
  const { user } = useAuth();

  const phoneClean = peerPhone?.replace(/\s+/g, '') || '';
  const callAllowed = canCall(myRole, peerRole, orderStatus);
  const terminal = isTerminalStatus(orderStatus);
  const canInApp = Boolean(peerUserId) && callAllowed;

  const handleInApp = () => {
    if (!peerUserId || !callAllowed) return;
    startCall({ orderId, receiverId: peerUserId, callerRole: myRole, receiverRole: peerRole, receiverName: peerName });
  };

  const handlePhone = () => {
    if (!phoneClean || !user || !callAllowed) return;
    logExternalCall({ orderId, callerId: user.id, receiverId: peerUserId, callerRole: myRole, receiverRole: peerRole, callType: 'Phone' });
    window.location.href = `tel:${phoneClean}`;
  };

  const handleWhatsApp = () => {
    if (!phoneClean || !user || terminal) return;
    logExternalCall({ orderId, callerId: user.id, receiverId: peerUserId, callerRole: myRole, receiverRole: peerRole, callType: 'WhatsApp' });
    const wa = phoneClean.replace(/^\+/, '');
    window.open(`https://wa.me/${wa}`, '_blank');
  };

  const size = compact ? 'sm' : 'default';

  // If nothing is available for this pairing/status, render nothing so the
  // container card can stay clean.
  if (terminal) return null;
  if (!callAllowed && !phoneClean) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {callAllowed && (
        <Button size={size} variant="default" onClick={handleInApp} disabled={!canInApp} className="gap-1.5">
          <PhoneCall className="w-4 h-4" /> In-App Call
        </Button>
      )}
      {callAllowed && phoneClean && (
        <Button size={size} variant="outline" onClick={handlePhone} className="gap-1.5">
          <Phone className="w-4 h-4" /> Phone
        </Button>
      )}
      {phoneClean && (
        <Button size={size} variant="outline" onClick={handleWhatsApp} className="gap-1.5 text-green-600 border-green-600/40 hover:bg-green-50 dark:hover:bg-green-950">
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </Button>
      )}
    </div>
  );
}
