import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface OrderProofPhotoUploadProps {
  orderId: string;
  vendorId: string;
  orderStatus: string;
}

export function OrderProofPhotoUpload({ orderId, vendorId, orderStatus }: OrderProofPhotoUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; photo_url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const canUpload = ['preparing', 'ready_for_pickup'].includes(orderStatus);
  const maxPhotos = 3;

  useEffect(() => {
    fetchPhotos();
  }, [orderId]);

  const fetchPhotos = async () => {
    try {
      const { data } = await supabase
        .from('order_proof_photos')
        .select('id, photo_url')
        .eq('order_id', orderId)
        .order('created_at');
      setPhotos(data || []);
    } catch (e) {
      console.error('Error fetching proof photos:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (photos.length >= maxPhotos) {
      toast({ title: 'Limit reached', description: `Maximum ${maxPhotos} photos per order.`, variant: 'destructive' });
      return;
    }

    const remaining = maxPhotos - photos.length;
    const filesToUpload = Array.from(files).slice(0, remaining);

    setUploading(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Not authenticated');

      for (const file of filesToUpload) {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `vendor-proof/${orderId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('order-photos')
          .upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('order-photos').getPublicUrl(path);

        await supabase.from('order_proof_photos').insert({
          order_id: orderId,
          vendor_id: vendorId,
          photo_url: urlData.publicUrl,
          storage_path: path,
          uploaded_by: user.id,
        });
      }

      toast({ title: 'Photos uploaded', description: 'Food proof photos saved successfully.' });
      await fetchPhotos();
    } catch (err: any) {
      console.error('Upload error:', err);
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  if (!canUpload && photos.length === 0) return null;

  return (
    <div className="space-y-2">
      {canUpload && photos.length === 0 && (
        <Alert className="border-primary/30 bg-primary/5">
          <Camera className="h-4 w-4 text-primary" />
          <AlertDescription className="text-xs text-muted-foreground">
            <strong className="text-foreground">Recommended:</strong> Take photos of the prepared food & packaging. This helps resolve disputes and protects your ratings. Photos are stored for 3 days.
          </AlertDescription>
        </Alert>
      )}

      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {photos.map((p) => (
            <div key={p.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={p.photo_url} alt="Food proof" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {/* Upload buttons */}
      {canUpload && photos.length < maxPhotos && (
        <div className="flex gap-2">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => cameraInputRef.current?.click()}
            className="gap-1 text-xs"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
            Camera
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1 text-xs"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            Gallery
          </Button>
          <span className="text-xs text-muted-foreground self-center">{photos.length}/{maxPhotos}</span>
        </div>
      )}
    </div>
  );
}
