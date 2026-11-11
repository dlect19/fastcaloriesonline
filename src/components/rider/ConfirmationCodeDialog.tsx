import { useState, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, Camera, Keyboard } from 'lucide-react';

interface ConfirmationCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (code: string) => void;
  isLoading?: boolean;
  orderNumber?: string;
}

export function ConfirmationCodeDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
  orderNumber,
}: ConfirmationCodeDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [scanMode, setScanMode] = useState(false);
  useEffect(() => {
    if (!open || !scanMode || isLoading) return;
    let active = true;
    let handled = false;
    const scanner = new Html5Qrcode('fastcalories-delivery-qr-reader');
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (decoded) => {
      if (!active || handled) return;
      const value = decoded.trim();
      if (!/^\\d{6}$/.test(value)) {
        setError('Invalid delivery QR code.');
        return;
      }
      handled = true;
      setError('');
      setCode(value);
      onConfirm(value);
    }, () => {}).catch(() => {
      if (active) setError('Camera unavailable. Allow camera access or enter the code manually.');
    });
    return () => {
      active = false;
      void scanner.stop().catch(() => {}).finally(() => { try { scanner.clear(); } catch {} });
    };
  }, [open, scanMode, isLoading, onConfirm]);
  useEffect(() => { if (!open) { setScanMode(false); setCode(''); setError(''); } }, [open]);

  const handleSubmit = () => {
    if (code.length !== 6) {
      setError('Please enter the complete 6-digit code');
      return;
    }
    setError('');
    onConfirm(code);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCode('');
      setError('');
      setScanMode(false);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify Delivery</DialogTitle>
          <DialogDescription>
            Scan the customer's QR code or enter the 6-digit delivery code
            {orderNumber && ` for Order #${orderNumber}`}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex gap-2">
          <Button type="button" variant={scanMode ? 'default' : 'outline'} className="flex-1" onClick={() => { setError(''); setScanMode(true); }} disabled={isLoading}><Camera className="w-4 h-4 mr-2" /> Scan QR</Button>
          <Button type="button" variant={!scanMode ? 'default' : 'outline'} className="flex-1" onClick={() => { setError(''); setScanMode(false); }} disabled={isLoading}><Keyboard className="w-4 h-4 mr-2" /> Enter Code</Button>
        </div>
        {scanMode ? <div className="py-3">
          <div id="fastcalories-delivery-qr-reader" className="w-full overflow-hidden rounded-lg" />
          <p className="text-xs text-muted-foreground text-center">Scan the QR code on the customer's phone.</p>
        </div> : <div className="flex flex-col items-center gap-4 py-4">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(value) => {
              setCode(value);
              setError('');
            }}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>}
        {scanMode && error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || scanMode || code.length !== 6}>
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirm Delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
