import { useState } from 'react';
import { Camera, QrCode, Utensils } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QRScanner } from './QRScanner';
import { CameraCalorieTracker } from './CameraCalorieTracker';

interface CameraActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CameraActionSheet({ open, onOpenChange }: CameraActionSheetProps) {
  const [showQR, setShowQR] = useState(false);
  const [showCalorie, setShowCalorie] = useState(false);

  const handleQR = () => {
    onOpenChange(false);
    setTimeout(() => setShowQR(true), 200);
  };

  const handleCalorie = () => {
    onOpenChange(false);
    setTimeout(() => setShowCalorie(true), 200);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              Camera Options
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Button
              variant="outline"
              className="w-full h-auto py-4 flex items-start gap-3 justify-start"
              onClick={handleQR}
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <QrCode className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">Scan QR Code</p>
                <p className="text-xs text-muted-foreground">Add a vendor to favourites</p>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full h-auto py-4 flex items-start gap-3 justify-start relative overflow-hidden"
              onClick={handleCalorie}
            >
              <div className="absolute top-1 right-1">
                <span className="text-[10px] font-bold bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">
                  NEW
                </span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                <Utensils className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">Track Meal Calories 📸</p>
                <p className="text-xs text-muted-foreground">Snap homemade food to log nutrition instantly</p>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <QRScanner open={showQR} onOpenChange={setShowQR} />
      <CameraCalorieTracker open={showCalorie} onOpenChange={setShowCalorie} />
    </>
  );
}
