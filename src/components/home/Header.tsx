import { useState } from 'react';
import { Bell, MapPin, Search, Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface HeaderProps {
  userName?: string;
  address?: string;
  onSearch?: (query: string) => void;
}

export function Header({ userName = 'Guest', address = 'Set your location', onSearch }: HeaderProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleQRScan = () => {
    // For now, show a dialog to enter vendor ID or QR code manually
    // In a real app, this would open the camera for QR scanning
    setShowQRDialog(true);
  };

  const handleManualCodeSubmit = () => {
    if (!manualCode.trim()) {
      toast({ title: 'Please enter a vendor code', variant: 'destructive' });
      return;
    }
    // Navigate to vendor with favorite action
    navigate(`/vendor/${manualCode.trim()}?action=favorite`);
    setShowQRDialog(false);
    setManualCode('');
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    onSearch?.(e.target.value);
  };

  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border safe-top">
        <div className="container py-4">
          {/* Top row: Location & Notifications */}
          <div className="flex items-center justify-between mb-4">
            <button className="flex items-center gap-2 text-left">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Deliver to</p>
                <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                  {address}
                </p>
              </div>
            </button>

            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
            </Button>
          </div>

          {/* Search bar with QR scanner */}
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search restaurants, dishes, groceries..."
                className="w-full h-12 pl-12 pr-4 bg-secondary rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <Button
              variant="secondary"
              size="icon"
              onClick={handleQRScan}
              className="h-12 w-12 rounded-xl shrink-0"
            >
              <Camera className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* QR Code / Manual Entry Dialog */}
      <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
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
            <div className="bg-muted/50 rounded-xl p-8 text-center">
              <Camera className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                Camera access is required to scan QR codes.
                <br />
                On mobile, use your camera app to scan.
              </p>
            </div>
            
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
                placeholder="Enter vendor ID from QR code"
                className="flex-1"
              />
              <Button onClick={handleManualCodeSubmit}>
                Go
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
