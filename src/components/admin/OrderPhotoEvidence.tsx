import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Camera, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface ProofPhoto {
  id: string;
  photo_url: string;
  photo_type: string;
  uploaded_at: string;
  expires_at: string;
}

interface DisputeImage {
  id: string;
  image_url: string;
  created_at: string;
}

interface OrderPhotoEvidenceProps {
  orderId: string;
  showDisputeImages?: boolean;
}

export function OrderPhotoEvidence({ orderId, showDisputeImages = false }: OrderPhotoEvidenceProps) {
  const [proofPhotos, setProofPhotos] = useState<ProofPhoto[]>([]);
  const [disputeImages, setDisputeImages] = useState<DisputeImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);

      const proofRes = await supabase
        .from('order_proof_photos')
        .select('id, photo_url, photo_type, uploaded_at, expires_at')
        .eq('order_id', orderId)
        .order('uploaded_at', { ascending: true });

      setProofPhotos((proofRes.data as ProofPhoto[]) || []);

      if (showDisputeImages) {
        const disputeRes = await supabase
          .from('dispute_images')
          .select('id, image_url, created_at')
          .eq('order_id', orderId)
          .order('created_at', { ascending: true });

        setDisputeImages((disputeRes.data as DisputeImage[]) || []);
      }


      setLoading(false);
    };
    fetch();
  }, [orderId, showDisputeImages]);

  if (loading) return null;
  if (proofPhotos.length === 0 && disputeImages.length === 0) return null;

  return (
    <>
      {proofPhotos.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Camera className="w-3.5 h-3.5" /> Vendor Proof Photos ({proofPhotos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-3 gap-2">
              {proofPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative group cursor-pointer rounded-lg overflow-hidden border border-border aspect-square"
                  onClick={() => setLightboxUrl(photo.photo_url)}
                >
                  <img
                    src={photo.photo_url}
                    alt="Vendor proof"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1.5 py-0.5">
                    {photo.photo_type === 'food_content' ? '🍽️ Food' : '📦 Package'}
                    <span className="ml-1">{format(new Date(photo.uploaded_at), 'HH:mm')}</span>
                  </div>
                  {new Date(photo.expires_at) < new Date() && (
                    <Badge variant="destructive" className="absolute top-1 right-1 text-[8px] px-1 py-0">
                      Expired
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Photos auto-delete 3 days after upload
            </p>
          </CardContent>
        </Card>
      )}

      {disputeImages.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <ImageIcon className="w-3.5 h-3.5" /> Customer Dispute Images ({disputeImages.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-3 gap-2">
              {disputeImages.map((img) => (
                <div
                  key={img.id}
                  className="relative group cursor-pointer rounded-lg overflow-hidden border border-border aspect-square"
                  onClick={() => setLightboxUrl(img.image_url)}
                >
                  <img
                    src={img.image_url}
                    alt="Customer dispute"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1.5 py-0.5">
                    📸 {format(new Date(img.created_at), 'dd MMM, HH:mm')}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-2">
          {lightboxUrl && (
            <img src={lightboxUrl} alt="Evidence" className="w-full h-auto rounded-lg max-h-[80vh] object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
