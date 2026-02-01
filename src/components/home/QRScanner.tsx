import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

interface QRScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Check if BarcodeDetector is supported
const isBarcodeDetectorSupported = 'BarcodeDetector' in window;

export function QRScanner({ open, onOpenChange }: QRScannerProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const parseQRContent = useCallback((content: string): string | null => {
    // Expected format: https://.../vendor/{id}?action=favorite or just the vendor ID
    try {
      const url = new URL(content);
      const pathParts = url.pathname.split('/');
      const vendorIndex = pathParts.indexOf('vendor');
      if (vendorIndex !== -1 && pathParts[vendorIndex + 1]) {
        return pathParts[vendorIndex + 1];
      }
    } catch {
      // Not a URL, might be just the vendor ID
      if (content.match(/^[a-f0-9-]{36}$/i) || content.match(/^[a-zA-Z0-9]{8,}$/)) {
        return content;
      }
    }
    return null;
  }, []);

  const handleQRDetected = useCallback((vendorId: string) => {
    stopCamera();
    onOpenChange(false);
    toast({ title: 'QR Code detected!', description: 'Navigating to vendor...' });
    navigate(`/vendor/${vendorId}?action=favorite`);
  }, [navigate, onOpenChange, stopCamera, toast]);

  const startCamera = useCallback(async () => {
    if (!isBarcodeDetectorSupported) {
      setCameraError('QR scanning is not supported in this browser. Please use Chrome, Edge, or Opera, or enter the vendor ID manually.');
      return;
    }

    setCameraError(null);
    setScanning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // @ts-ignore - BarcodeDetector is not in TypeScript types
        const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });

        const detect = async () => {
          if (!videoRef.current || !streamRef.current) return;

          try {
            // @ts-ignore
            const barcodes = await barcodeDetector.detect(videoRef.current);
            
            if (barcodes.length > 0) {
              const vendorId = parseQRContent(barcodes[0].rawValue);
              if (vendorId) {
                handleQRDetected(vendorId);
                return;
              }
            }
          } catch (err) {
            // Detection error, continue scanning
          }

          animationRef.current = requestAnimationFrame(detect);
        };

        animationRef.current = requestAnimationFrame(detect);
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera access was denied. Please allow camera access and try again.'
          : 'Failed to access camera. Please try entering the vendor ID manually.'
      );
      setScanning(false);
    }
  }, [handleQRDetected, parseQRContent]);

  useEffect(() => {
    if (open && isBarcodeDetectorSupported) {
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setManualCode('');
      setCameraError(null);
    }
  }, [open, stopCamera]);

  const handleManualCodeSubmit = () => {
    if (!manualCode.trim()) {
      toast({ title: 'Please enter a vendor code', variant: 'destructive' });
      return;
    }
    const vendorId = parseQRContent(manualCode.trim());
    if (vendorId) {
      handleQRDetected(vendorId);
    } else {
      // Try using the raw input as vendor ID
      handleQRDetected(manualCode.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Scan Store QR Code
          </DialogTitle>
          <DialogDescription>
            Scan a store's QR code to quickly add them to favorites or start ordering.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Camera View */}
          {isBarcodeDetectorSupported && !cameraError ? (
            <div className="relative bg-black rounded-xl overflow-hidden aspect-square">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-primary rounded-lg animate-pulse" />
                </div>
              )}
              {scanning && (
                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <span className="bg-black/60 text-white text-sm px-3 py-1 rounded-full">
                    Point camera at QR code
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-muted/50 rounded-xl p-8 text-center">
              {cameraError ? (
                <>
                  <AlertCircle className="w-12 h-12 text-warning mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                </>
              ) : (
                <>
                  <Camera className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">
                    QR scanning is not supported in this browser.
                    <br />
                    Please enter the vendor ID manually below.
                  </p>
                </>
              )}
            </div>
          )}
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or enter vendor ID manually
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualCodeSubmit()}
              placeholder="Enter vendor ID or paste link"
              className="flex-1"
            />
            <Button onClick={handleManualCodeSubmit}>
              Go
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
