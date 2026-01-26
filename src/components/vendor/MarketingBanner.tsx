import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Download, Printer, QrCode, Loader2 } from 'lucide-react';

interface MarketingBannerProps {
  vendor: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    logo_url: string | null;
  };
}

type PaperSize = 'A3' | 'A4';

const PAPER_DIMENSIONS: Record<PaperSize, { width: number; height: number; label: string }> = {
  A4: { width: 210, height: 297, label: 'A4 (210×297mm)' },
  A3: { width: 297, height: 420, label: 'A3 (297×420mm)' },
};

export function MarketingBanner({ vendor }: MarketingBannerProps) {
  const { toast } = useToast();
  const bannerRef = useRef<HTMLDivElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [storeQR, setStoreQR] = useState<string>('');
  const [websiteQR, setWebsiteQR] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const storeUrl = `${window.location.origin}/vendor/${vendor.id}`;
  const websiteUrl = 'https://www.fastcalories.online';

  useEffect(() => {
    if (dialogOpen) {
      generateQRCodes();
    }
  }, [dialogOpen, vendor.id]);

  const generateQRCodes = async () => {
    setGenerating(true);
    try {
      const [storeQRDataUrl, websiteQRDataUrl] = await Promise.all([
        QRCode.toDataURL(storeUrl, {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        }),
        QRCode.toDataURL(websiteUrl, {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        }),
      ]);
      setStoreQR(storeQRDataUrl);
      setWebsiteQR(websiteQRDataUrl);
    } catch (error) {
      console.error('Error generating QR codes:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate QR codes',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!bannerRef.current) return;
    
    setDownloading(true);
    try {
      const canvas = await html2canvas(bannerRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: paperSize.toLowerCase() as 'a3' | 'a4',
      });

      const dims = PAPER_DIMENSIONS[paperSize];
      pdf.addImage(imgData, 'PNG', 0, 0, dims.width, dims.height);
      pdf.save(`${vendor.name.replace(/\s+/g, '-')}-banner-${paperSize}.pdf`);

      toast({
        title: 'Banner downloaded',
        description: `Your ${paperSize} marketing banner has been saved as PDF`,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: 'Download failed',
        description: 'Could not generate the PDF. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!bannerRef.current) return;
    
    setDownloading(true);
    try {
      const canvas = await html2canvas(bannerRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      const link = document.createElement('a');
      link.download = `${vendor.name.replace(/\s+/g, '-')}-banner-${paperSize}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      toast({
        title: 'Banner downloaded',
        description: `Your ${paperSize} marketing banner has been saved as PNG`,
      });
    } catch (error) {
      console.error('Error generating image:', error);
      toast({
        title: 'Download failed',
        description: 'Could not generate the image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const dims = PAPER_DIMENSIONS[paperSize];
  const scale = paperSize === 'A3' ? 0.6 : 0.8;

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Printer className="w-4 h-4" />
          Generate Marketing Banner
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            Marketing Banner Generator
          </DialogTitle>
          <DialogDescription>
            Generate a printable banner with QR codes for in-store customer discovery
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Paper Size</Label>
              <Select value={paperSize} onValueChange={(v) => setPaperSize(v as PaperSize)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">{PAPER_DIMENSIONS.A4.label}</SelectItem>
                  <SelectItem value="A3">{PAPER_DIMENSIONS.A3.label}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleDownloadPDF} disabled={downloading || generating}>
                {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
              <Button variant="outline" onClick={handleDownloadImage} disabled={downloading || generating}>
                Download PNG
              </Button>
            </div>
          </div>

          {/* Banner Preview */}
          <div className="border rounded-lg overflow-hidden bg-muted p-4">
            <div className="flex justify-center">
              <div
                ref={bannerRef}
                style={{
                  width: `${dims.width * scale}mm`,
                  height: `${dims.height * scale}mm`,
                  minWidth: `${dims.width * scale}mm`,
                  minHeight: `${dims.height * scale}mm`,
                }}
                className="bg-white shadow-lg flex flex-col"
              >
                {/* Header with Logo and Store Info */}
                <div 
                  className="flex items-center gap-4 p-6 border-b-4 border-primary"
                  style={{ padding: paperSize === 'A3' ? '32px' : '24px' }}
                >
                  {vendor.logo_url ? (
                    <img
                      src={vendor.logo_url}
                      alt={vendor.name}
                      className="rounded-xl object-cover"
                      style={{ 
                        width: paperSize === 'A3' ? '80px' : '60px',
                        height: paperSize === 'A3' ? '80px' : '60px',
                      }}
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div 
                      className="rounded-xl bg-primary/10 flex items-center justify-center"
                      style={{ 
                        width: paperSize === 'A3' ? '80px' : '60px',
                        height: paperSize === 'A3' ? '80px' : '60px',
                      }}
                    >
                      <span 
                        className="font-bold text-primary"
                        style={{ fontSize: paperSize === 'A3' ? '28px' : '20px' }}
                      >
                        {vendor.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <div className="flex-1">
                    <h1 
                      className="font-bold text-gray-900 leading-tight"
                      style={{ fontSize: paperSize === 'A3' ? '28px' : '20px' }}
                    >
                      {vendor.name}
                    </h1>
                    <p 
                      className="text-gray-600"
                      style={{ fontSize: paperSize === 'A3' ? '14px' : '11px' }}
                    >
                      {vendor.address}, {vendor.city}, {vendor.state}
                    </p>
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <div 
                    className="bg-gradient-to-r from-primary to-primary/80 text-white font-bold rounded-xl px-6 py-4 mb-6"
                    style={{ 
                      fontSize: paperSize === 'A3' ? '24px' : '16px',
                      padding: paperSize === 'A3' ? '20px 32px' : '16px 24px',
                    }}
                  >
                    Order from us online!
                  </div>

                  <p 
                    className="text-gray-700 mb-8"
                    style={{ fontSize: paperSize === 'A3' ? '16px' : '12px' }}
                  >
                    Scan the QR codes below to get started
                  </p>

                  {/* QR Codes */}
                  <div 
                    className="flex justify-center gap-12"
                    style={{ gap: paperSize === 'A3' ? '48px' : '32px' }}
                  >
                    {/* Store QR */}
                    <div className="text-center">
                      <div 
                        className="bg-white border-2 border-gray-200 rounded-xl p-3 mb-3"
                        style={{ padding: paperSize === 'A3' ? '16px' : '12px' }}
                      >
                        {generating ? (
                          <div 
                            className="flex items-center justify-center bg-gray-100"
                            style={{ 
                              width: paperSize === 'A3' ? '140px' : '100px',
                              height: paperSize === 'A3' ? '140px' : '100px',
                            }}
                          >
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                          </div>
                        ) : (
                          <img
                            src={storeQR}
                            alt="Store QR Code"
                            style={{ 
                              width: paperSize === 'A3' ? '140px' : '100px',
                              height: paperSize === 'A3' ? '140px' : '100px',
                            }}
                          />
                        )}
                      </div>
                      <p 
                        className="font-semibold text-gray-900"
                        style={{ fontSize: paperSize === 'A3' ? '14px' : '10px' }}
                      >
                        Find Our Store
                      </p>
                      <p 
                        className="text-gray-500"
                        style={{ fontSize: paperSize === 'A3' ? '11px' : '8px' }}
                      >
                        on Fast Calories
                      </p>
                    </div>

                    {/* Website QR */}
                    <div className="text-center">
                      <div 
                        className="bg-white border-2 border-gray-200 rounded-xl p-3 mb-3"
                        style={{ padding: paperSize === 'A3' ? '16px' : '12px' }}
                      >
                        {generating ? (
                          <div 
                            className="flex items-center justify-center bg-gray-100"
                            style={{ 
                              width: paperSize === 'A3' ? '140px' : '100px',
                              height: paperSize === 'A3' ? '140px' : '100px',
                            }}
                          >
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                          </div>
                        ) : (
                          <img
                            src={websiteQR}
                            alt="Website QR Code"
                            style={{ 
                              width: paperSize === 'A3' ? '140px' : '100px',
                              height: paperSize === 'A3' ? '140px' : '100px',
                            }}
                          />
                        )}
                      </div>
                      <p 
                        className="font-semibold text-gray-900"
                        style={{ fontSize: paperSize === 'A3' ? '14px' : '10px' }}
                      >
                        Visit Our Website
                      </p>
                      <p 
                        className="text-gray-500"
                        style={{ fontSize: paperSize === 'A3' ? '11px' : '8px' }}
                      >
                        fastcalories.online
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div 
                  className="bg-gray-100 py-4 text-center"
                  style={{ padding: paperSize === 'A3' ? '20px' : '16px' }}
                >
                  <p 
                    className="text-gray-600"
                    style={{ fontSize: paperSize === 'A3' ? '12px' : '9px' }}
                  >
                    Powered by <span className="font-semibold text-primary">Fast Calories</span> • Healthy Eating Made Easy
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            This banner is optimized for printing at {paperSize} size. Download as PDF for best print quality.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
