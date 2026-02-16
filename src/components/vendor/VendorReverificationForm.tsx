import { useState, useRef } from 'react';
import { MapPin, Upload, Loader2, Navigation } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useGeolocation } from '@/hooks/useGeolocation';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  vendorId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const DOC_TYPES = [
  { key: 'cac_registration', label: 'CAC Registration' },
  { key: 'utility_bill', label: 'Utility Bill' },
  { key: 'storefront_photo', label: 'Storefront Photo' },
  { key: 'government_id', label: 'Government ID' },
  { key: 'license', label: 'Optional License' },
];

export function VendorReverificationForm({ open, vendorId, onClose, onSubmitted }: Props) {
  const { toast } = useToast();
  const { latitude, longitude, loading: geoLoading, getCurrentPosition } = useGeolocation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploads, setUploads] = useState<Record<string, File | null>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleFileChange = (docType: string, file: File | null) => {
    setUploads(prev => ({ ...prev, [docType]: file }));
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({ title: 'Please provide a reason for the location change', variant: 'destructive' });
      return;
    }
    if (!latitude || !longitude) {
      toast({ title: 'Please capture your current GPS location first', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Not authenticated');

      // Upload documents
      for (const [docType, file] of Object.entries(uploads)) {
        if (!file) continue;
        setUploadingDoc(docType);
        const ext = file.name.split('.').pop();
        const path = `${user.id}/${vendorId}/${docType}-${Date.now()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('vendor-verification-docs')
          .upload(path, file, { upsert: true });

        if (uploadErr) throw uploadErr;

        // Save document record
        await supabase.from('vendor_verification_documents').insert({
          vendor_id: vendorId,
          document_type: docType,
          file_url: path,
          file_name: file.name,
        });
      }
      setUploadingDoc(null);

      // Create reverification request
      const { error } = await supabase.from('vendor_reverification_requests').insert({
        vendor_id: vendorId,
        reason: reason.trim(),
        new_latitude: latitude,
        new_longitude: longitude,
      });

      if (error) throw error;

      toast({ title: 'Reverification request submitted', description: 'Admin will review your request shortly.' });
      onSubmitted();
    } catch (err: any) {
      toast({ title: 'Failed to submit', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
      setUploadingDoc(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Reverification Request
          </DialogTitle>
          <DialogDescription>
            Submit a new GPS location and supporting documents to unlock your store.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Reason */}
          <div className="space-y-2">
            <Label>Reason for location change *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why your location has changed..."
              rows={3}
            />
          </div>

          {/* GPS Capture */}
          <div className="space-y-2">
            <Label>New GPS Location *</Label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={getCurrentPosition}
                disabled={geoLoading}
                className="gap-2"
              >
                <Navigation className="w-4 h-4" />
                {geoLoading ? 'Getting location...' : 'Capture GPS'}
              </Button>
              {latitude && longitude && (
                <span className="text-sm text-muted-foreground">
                  📍 {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </span>
              )}
            </div>
          </div>

          {/* Document Uploads */}
          <div className="space-y-3">
            <Label>Supporting Documents</Label>
            {DOC_TYPES.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-3 p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium">{label}</p>
                  {uploads[key] && (
                    <p className="text-xs text-muted-foreground truncate">{uploads[key]!.name}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRefs.current[key]?.click()}
                  disabled={uploadingDoc === key}
                  className="gap-1"
                >
                  {uploadingDoc === key ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {uploads[key] ? 'Change' : 'Upload'}
                </Button>
                <input
                  ref={(el) => { fileRefs.current[key] = el; }}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => handleFileChange(key, e.target.files?.[0] || null)}
                />
              </div>
            ))}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !reason.trim() || !latitude || !longitude}
            className="w-full gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {submitting ? 'Submitting...' : 'Submit Reverification Request'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
