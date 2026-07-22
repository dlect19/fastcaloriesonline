import { useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle2 } from 'lucide-react';
import { VoucherPreview, VoucherPreviewHandle, VoucherPreviewData } from './VoucherPreview';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  onClose: () => void;
  data: VoucherPreviewData;
  orderId?: string;
}

export function PurchaseSuccessDialog({ open, onClose, data, orderId }: Props) {
  const ref = useRef<VoucherPreviewHandle>(null);

  // Persist rendered image (best-effort) so the customer can see it later
  useEffect(() => {
    if (!open || !orderId) return;
    const timer = setTimeout(async () => {
      try {
        const blob = await ref.current?.toBlob();
        if (!blob) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const path = `${user.id}/${orderId}.png`;
        const { error } = await supabase.storage.from('voucher-images').upload(path, blob, { contentType: 'image/png', upsert: true });
        if (error) return;
        const { data: signed } = await supabase.storage.from('voucher-images').createSignedUrl(path, 60 * 60 * 24 * 365);
        if (signed?.signedUrl) {
          await supabase.from('voucher_orders').update({ rendered_image_url: signed.signedUrl }).eq('id', orderId);
        }
      } catch {/* non-blocking */}
    }, 800);
    return () => clearTimeout(timer);
  }, [open, orderId]);

  const download = () => {
    const url = ref.current?.toDataURL();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `voucher-${data.code}.png`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600" /> Voucher purchased</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <VoucherPreview ref={ref} {...data} />
          <div className="flex gap-2 w-full">
            <Button onClick={download} className="flex-1"><Download className="w-4 h-4 mr-1" /> Download</Button>
            <Button variant="outline" onClick={onClose} className="flex-1">Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
