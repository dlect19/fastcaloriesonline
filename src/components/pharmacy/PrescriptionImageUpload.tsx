import { useRef, useState } from 'react';
import { Camera, Upload, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  userId: string;
  productId: string;
  value: string;
  onChange: (path: string) => void;
  label?: string;
  required?: boolean;
}

/**
 * Uploads a prescription photo to the private `prescriptions` bucket.
 * Returns the storage object path (folder = user id, required by RLS).
 */
export function PrescriptionImageUpload({ userId, productId, value, onChange, label = 'Prescription Photo', required }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Please select an image', variant: 'destructive' });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Max 8MB', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/${productId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('prescriptions').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      onChange(path);
      const { data: signed } = await supabase.storage.from('prescriptions').createSignedUrl(path, 300);
      setPreviewUrl(signed?.signedUrl || null);
      toast({ title: 'Prescription uploaded' });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
      {value ? (
        <div className="relative inline-block">
          <img
            src={previewUrl || ''}
            alt="Prescription"
            className="w-32 h-32 object-cover rounded border border-border bg-muted"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
          <button
            type="button"
            onClick={() => {
              onChange('');
              setPreviewUrl(null);
            }}
            className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow"
            aria-label="Remove"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-20 border-dashed flex-col gap-1"
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <Camera className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Take photo or upload</span>
            </>
          )}
        </Button>
      )}
    </div>
  );
}
