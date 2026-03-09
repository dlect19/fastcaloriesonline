import { useState, useRef } from 'react';
import { Camera, Upload, X, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface DisputeReportFormProps {
  orderId: string;
  orderNumber: string;
  onSubmitted?: () => void;
}

const DISPUTE_REASONS = [
  'Wrong food delivered',
  'Missing items',
  'Food quality issue',
  'Food arrived cold/spoiled',
  'Packaging was damaged',
  'Order never arrived',
  'Overcharged',
  'Other',
];

export function DisputeReportForm({ orderId, orderNumber, onSubmitted }: DisputeReportFormProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const maxImages = 3;

  const handleAddImages = (files: FileList | null) => {
    if (!files) return;
    const remaining = maxImages - images.length;
    const newFiles = Array.from(files).slice(0, remaining).map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setImages(prev => [...prev, ...newFiles]);
  };

  const removeImage = (index: number) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async () => {
    if (!reason) {
      toast({ title: 'Select a reason', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Not authenticated');

      // Upload images
      const uploadedUrls: string[] = [];
      for (const img of images) {
        const ext = img.file.name.split('.').pop() || 'jpg';
        const path = `dispute-images/${orderId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('order-photos')
          .upload(path, img.file, { contentType: img.file.type });
        if (upErr) throw upErr;

        const { data: urlData } = supabase.storage.from('order-photos').getPublicUrl(path);
        uploadedUrls.push(urlData.publicUrl);

        await supabase.from('dispute_images').insert({
          order_id: orderId,
          image_url: urlData.publicUrl,
          storage_path: path,
          uploaded_by: user.id,
        });
      }

      // Create support ticket / complaint record
      const { error: ticketError } = await supabase.from('support_tickets').insert({
        user_id: user.id,
        order_id: orderId,
        subject: `Complaint: ${reason} - Order #${orderNumber}`,
        message: `Reason: ${reason}\n\n${details}${uploadedUrls.length > 0 ? '\n\nAttached images: ' + uploadedUrls.join(', ') : ''}`,
        category: 'complaint',
        status: 'open',
      });

      if (ticketError) throw ticketError;

      toast({ title: 'Complaint submitted', description: 'Our team will review your complaint and get back to you.' });
      setSubmitted(true);
      onSubmitted?.();
    } catch (err: any) {
      console.error('Submit error:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 text-center">
          <p className="text-sm text-muted-foreground">✅ Your complaint has been submitted. We'll review it shortly.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          Report an Issue
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger>
            <SelectValue placeholder="Select a reason..." />
          </SelectTrigger>
          <SelectContent>
            {DISPUTE_REASONS.map(r => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Textarea
          placeholder="Describe the issue in detail..."
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
        />

        {/* Image uploads */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Attach photos (optional, up to {maxImages})</p>
          {images.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                  <img src={img.preview} alt="Evidence" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.length < maxImages && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleAddImages(e.target.files)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1"
              >
                <Camera className="w-4 h-4" />
                Add Photos
              </Button>
            </>
          )}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting || !reason}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit Complaint'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
