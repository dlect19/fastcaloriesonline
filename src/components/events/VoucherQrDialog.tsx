import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import type { VoucherRow } from '@/hooks/useMyVouchers';

interface Props { voucher: VoucherRow; onClose: () => void; }

export function VoucherQrDialog({ voucher, onClose }: Props) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(voucher.qr_token, { width: 320, margin: 1 })
      .then(setQr).catch(() => setQr(null));
  }, [voucher.qr_token]);

  const statusLabel: Record<string, string> = {
    generated: 'Ready to redeem',
    reserved: 'Reserved for delivery',
    redeemed: 'Already redeemed',
    expired: 'Expired',
    cancelled: 'Cancelled',
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{voucher.event_voucher_templates?.name || 'Food Voucher'}</DialogTitle>
        </DialogHeader>
        <div className="text-center space-y-3">
          <p className="text-xs text-muted-foreground">
            {voucher.vendors?.name ? `Redeem at ${voucher.vendors.name}` : 'Redeem at the event'}
          </p>
          <div className="bg-white rounded-lg p-4 inline-block">
            {qr ? <img src={qr} alt="Voucher QR" className="w-56 h-56" /> : <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground">Voucher code</p>
          <p className="text-base font-mono font-bold tracking-wider">{voucher.voucher_code}</p>
          <p className={`text-xs font-semibold ${voucher.status === 'generated' ? 'text-primary' : voucher.status === 'redeemed' ? 'text-green-600' : 'text-muted-foreground'}`}>
            {statusLabel[voucher.status] || voucher.status}
          </p>
          {voucher.expires_at && (
            <p className="text-[11px] text-muted-foreground">Expires {new Date(voucher.expires_at).toLocaleString()}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
