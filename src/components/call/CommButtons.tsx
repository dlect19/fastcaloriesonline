import { Phone, MessageCircle, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCall } from '@/components/call/CallProvider';
import { logExternalCall } from '@/hooks/useZegoCall';
import { useAuth } from '@/hooks/useAuth';

type Role = 'customer' | 'vendor' | 'rider';

interface Props {
  orderId: string;
  peerUserId: string | null;
  peerPhone?: string | null;
  peerName?: string;
  myRole: Role;
  peerRole: Role;
  compact?: boolean;
}

export function CommButtons({ orderId, peerUserId, peerPhone, peerName, myRole, peerRole, compact }: Props) {
  const { startCall } = useCall();
  const { user } = useAuth();

  const phoneClean = peerPhone?.replace(/\s+/g, '') || '';
  const canInApp = Boolean(peerUserId);

  const handleInApp = () => {
    if (!peerUserId) return;
    startCall({ orderId, receiverId: peerUserId, callerRole: myRole, receiverRole: peerRole, receiverName: peerName });
  };

  const handlePhone = () => {
    if (!phoneClean || !user) return;
    logExternalCall({ orderId, callerId: user.id, receiverId: peerUserId, callerRole: myRole, receiverRole: peerRole, callType: 'Phone' });
    window.location.href = `tel:${phoneClean}`;
  };

  const handleWhatsApp = () => {
    if (!phoneClean || !user) return;
    logExternalCall({ orderId, callerId: user.id, receiverId: peerUserId, callerRole: myRole, receiverRole: peerRole, callType: 'WhatsApp' });
    const wa = phoneClean.replace(/^\+/, '');
    window.open(`https://wa.me/${wa}`, '_blank');
  };

  const size = compact ? 'sm' : 'default';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button size={size} variant="default" onClick={handleInApp} disabled={!canInApp} className="gap-1.5">
        <PhoneCall className="w-4 h-4" /> In-App Call
      </Button>
      <Button size={size} variant="outline" onClick={handlePhone} disabled={!phoneClean} className="gap-1.5">
        <Phone className="w-4 h-4" /> Phone
      </Button>
      <Button size={size} variant="outline" onClick={handleWhatsApp} disabled={!phoneClean} className="gap-1.5 text-green-600 border-green-600/40 hover:bg-green-50 dark:hover:bg-green-950">
        <MessageCircle className="w-4 h-4" /> WhatsApp
      </Button>
    </div>
  );
}
