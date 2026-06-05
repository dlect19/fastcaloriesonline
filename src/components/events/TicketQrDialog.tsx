import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, parseISO } from 'date-fns';

interface Props {
  ticket: any;
  onClose: () => void;
}

export function TicketQrDialog({ ticket, onClose }: Props) {
  const [qrUrl, setQrUrl] = useState<string>('');

  useEffect(() => {
    QRCode.toDataURL(ticket.qr_token, { width: 320, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [ticket.qr_token]);

  const e = ticket.events;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{e?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">{ticket.event_ticket_types?.name}</p>
            {e?.event_date && (
              <p className="text-xs text-muted-foreground">
                {format(parseISO(e.event_date), 'EEE, MMM d, yyyy')}{e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ''}
              </p>
            )}
          </div>

          {ticket.status === 'checked_in' ? (
            <div className="text-center py-8 bg-green-500/10 rounded-lg">
              <p className="text-lg font-bold text-green-600">✓ Checked In</p>
              {ticket.checked_in_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(ticket.checked_in_at), 'MMM d, h:mm a')}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg p-4 flex items-center justify-center">
              {qrUrl ? <img src={qrUrl} alt="Ticket QR" className="w-64 h-64" /> : <div className="w-64 h-64 bg-muted animate-pulse" />}
            </div>
          )}

          <div className="text-center">
            <p className="text-xs text-muted-foreground">Ticket Code</p>
            <p className="font-mono font-bold text-lg tracking-wider">{ticket.ticket_code}</p>
          </div>

          <p className="text-[10px] text-center text-muted-foreground">
            Show this QR or read the code to the event staff for entry.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
