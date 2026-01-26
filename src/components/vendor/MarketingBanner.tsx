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
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

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
          width: 300,
          margin: 2,
          color: { dark: '#16a34a', light: '#ffffff' },
        }),
        QRCode.toDataURL(websiteUrl, {
          width: 300,
          margin: 2,
          color: { dark: '#dc2626', light: '#ffffff' },
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
  const scale = paperSize === 'A3' ? 0.55 : 0.75;
  const isA3 = paperSize === 'A3';

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
                className="bg-white shadow-lg flex flex-col overflow-hidden"
              >
                {/* Top decorative wave */}
                <div 
                  className="relative"
                  style={{ 
                    background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 50%, #16a34a 100%)',
                    height: isA3 ? '80px' : '50px',
                  }}
                >
                  <svg 
                    viewBox="0 0 1440 120" 
                    className="absolute bottom-0 left-0 w-full"
                    style={{ transform: 'translateY(50%)' }}
                    preserveAspectRatio="none"
                  >
                    <path 
                      fill="#ffffff" 
                      d="M0,64L48,58.7C96,53,192,43,288,48C384,53,480,75,576,80C672,85,768,75,864,64C960,53,1056,43,1152,48C1248,53,1344,75,1392,85.3L1440,96L1440,120L1392,120C1344,120,1248,120,1152,120C1056,120,960,120,864,120C768,120,672,120,576,120C480,120,384,120,288,120C192,120,96,120,48,120L0,120Z"
                    />
                  </svg>
                </div>

                {/* Vendor Header Section */}
                <div 
                  className="flex flex-col items-center text-center px-6"
                  style={{ 
                    paddingTop: isA3 ? '48px' : '32px',
                    paddingBottom: isA3 ? '24px' : '16px',
                  }}
                >
                  {/* Vendor Logo */}
                  {vendor.logo_url ? (
                    <div 
                      className="rounded-2xl overflow-hidden border-4 border-gray-100 shadow-lg mb-4"
                      style={{ 
                        width: isA3 ? '100px' : '70px',
                        height: isA3 ? '100px' : '70px',
                      }}
                    >
                      <img
                        src={vendor.logo_url}
                        alt={vendor.name}
                        className="w-full h-full object-cover"
                        crossOrigin="anonymous"
                      />
                    </div>
                  ) : (
                    <div 
                      className="rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg mb-4"
                      style={{ 
                        width: isA3 ? '100px' : '70px',
                        height: isA3 ? '100px' : '70px',
                      }}
                    >
                      <span 
                        className="font-bold text-white"
                        style={{ fontSize: isA3 ? '36px' : '26px' }}
                      >
                        {vendor.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  
                  <h1 
                    className="font-bold text-gray-900 leading-tight"
                    style={{ fontSize: isA3 ? '32px' : '22px' }}
                  >
                    {vendor.name}
                  </h1>
                  <p 
                    className="text-gray-500 mt-1"
                    style={{ fontSize: isA3 ? '14px' : '10px' }}
                  >
                    📍 {vendor.address}, {vendor.city}, {vendor.state}
                  </p>
                </div>

                {/* Main CTA Section */}
                <div 
                  className="flex-1 flex flex-col items-center justify-center px-6 text-center"
                  style={{ 
                    background: 'linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%)',
                    paddingTop: isA3 ? '24px' : '16px',
                    paddingBottom: isA3 ? '24px' : '16px',
                  }}
                >
                  {/* Attention grabber */}
                  <div 
                    className="inline-flex items-center gap-2 rounded-full bg-red-50 border-2 border-red-200 mb-4"
                    style={{ 
                      padding: isA3 ? '10px 24px' : '6px 16px',
                    }}
                  >
                    <span style={{ fontSize: isA3 ? '22px' : '14px' }}>🔥</span>
                    <span 
                      className="font-bold text-red-600"
                      style={{ fontSize: isA3 ? '16px' : '11px' }}
                    >
                      ORDER ONLINE NOW!
                    </span>
                  </div>

                  {/* Main headline */}
                  <h2 
                    className="font-extrabold text-gray-900 leading-tight mb-2"
                    style={{ fontSize: isA3 ? '36px' : '24px' }}
                  >
                    Skip the Queue!
                  </h2>
                  <p 
                    className="text-gray-600 max-w-md"
                    style={{ 
                      fontSize: isA3 ? '16px' : '11px',
                      marginBottom: isA3 ? '28px' : '18px',
                    }}
                  >
                    Scan the QR code below to order directly from your phone
                  </p>

                  {/* QR Codes Section */}
                  <div 
                    className="flex justify-center items-stretch gap-6"
                    style={{ gap: isA3 ? '40px' : '24px' }}
                  >
                    {/* Store QR */}
                    <div className="text-center flex flex-col items-center">
                      <div 
                        className="bg-white rounded-2xl border-4 border-green-500 shadow-lg p-3 mb-3"
                        style={{ 
                          padding: isA3 ? '16px' : '10px',
                          borderRadius: isA3 ? '20px' : '14px',
                        }}
                      >
                        {generating ? (
                          <div 
                            className="flex items-center justify-center bg-gray-50 rounded-xl"
                            style={{ 
                              width: isA3 ? '160px' : '100px',
                              height: isA3 ? '160px' : '100px',
                            }}
                          >
                            <Loader2 className="w-8 h-8 animate-spin text-green-500" />
                          </div>
                        ) : (
                          <img
                            src={storeQR}
                            alt="Store QR Code"
                            className="rounded-lg"
                            style={{ 
                              width: isA3 ? '160px' : '100px',
                              height: isA3 ? '160px' : '100px',
                            }}
                          />
                        )}
                      </div>
                      <div 
                        className="bg-green-600 text-white font-bold rounded-lg"
                        style={{ 
                          padding: isA3 ? '8px 16px' : '5px 10px',
                          fontSize: isA3 ? '14px' : '9px',
                        }}
                      >
                        ORDER HERE
                      </div>
                      <p 
                        className="text-gray-500 mt-2"
                        style={{ fontSize: isA3 ? '11px' : '7px' }}
                      >
                        Scan to see our menu
                      </p>
                    </div>

                    {/* Divider */}
                    <div className="flex flex-col items-center justify-center">
                      <div 
                        className="w-px bg-gray-200"
                        style={{ height: isA3 ? '120px' : '80px' }}
                      />
                      <span 
                        className="text-gray-400 font-medium my-2"
                        style={{ fontSize: isA3 ? '12px' : '8px' }}
                      >
                        OR
                      </span>
                      <div 
                        className="w-px bg-gray-200"
                        style={{ height: isA3 ? '120px' : '80px' }}
                      />
                    </div>

                    {/* Website QR */}
                    <div className="text-center flex flex-col items-center">
                      <div 
                        className="bg-white rounded-2xl border-4 border-red-500 shadow-lg p-3 mb-3"
                        style={{ 
                          padding: isA3 ? '16px' : '10px',
                          borderRadius: isA3 ? '20px' : '14px',
                        }}
                      >
                        {generating ? (
                          <div 
                            className="flex items-center justify-center bg-gray-50 rounded-xl"
                            style={{ 
                              width: isA3 ? '160px' : '100px',
                              height: isA3 ? '160px' : '100px',
                            }}
                          >
                            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                          </div>
                        ) : (
                          <img
                            src={websiteQR}
                            alt="Website QR Code"
                            className="rounded-lg"
                            style={{ 
                              width: isA3 ? '160px' : '100px',
                              height: isA3 ? '160px' : '100px',
                            }}
                          />
                        )}
                      </div>
                      <div 
                        className="bg-red-600 text-white font-bold rounded-lg"
                        style={{ 
                          padding: isA3 ? '8px 16px' : '5px 10px',
                          fontSize: isA3 ? '14px' : '9px',
                        }}
                      >
                        EXPLORE MORE
                      </div>
                      <p 
                        className="text-gray-500 mt-2"
                        style={{ fontSize: isA3 ? '11px' : '7px' }}
                      >
                        Visit fastcalories.online
                      </p>
                    </div>
                  </div>
                </div>

                {/* Benefits strip */}
                <div 
                  className="flex justify-center items-center gap-4 bg-gray-50 border-t border-gray-100"
                  style={{ 
                    padding: isA3 ? '16px' : '10px',
                    gap: isA3 ? '24px' : '14px',
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span style={{ fontSize: isA3 ? '16px' : '11px' }}>⚡</span>
                    <span 
                      className="font-medium text-gray-700"
                      style={{ fontSize: isA3 ? '12px' : '8px' }}
                    >
                      Fast Delivery
                    </span>
                  </div>
                  <div 
                    className="w-1 h-1 rounded-full bg-gray-300"
                    style={{ 
                      width: isA3 ? '4px' : '3px',
                      height: isA3 ? '4px' : '3px',
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <span style={{ fontSize: isA3 ? '16px' : '11px' }}>🔥</span>
                    <span 
                      className="font-medium text-gray-700"
                      style={{ fontSize: isA3 ? '12px' : '8px' }}
                    >
                      Calorie Tracking
                    </span>
                  </div>
                  <div 
                    className="w-1 h-1 rounded-full bg-gray-300"
                    style={{ 
                      width: isA3 ? '4px' : '3px',
                      height: isA3 ? '4px' : '3px',
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <span style={{ fontSize: isA3 ? '16px' : '11px' }}>💳</span>
                    <span 
                      className="font-medium text-gray-700"
                      style={{ fontSize: isA3 ? '12px' : '8px' }}
                    >
                      Easy Payment
                    </span>
                  </div>
                </div>

                {/* Footer with platform branding */}
                <div 
                  className="flex items-center justify-center gap-3"
                  style={{ 
                    background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
                    padding: isA3 ? '20px' : '12px',
                  }}
                >
                  <img 
                    src={fastCaloriesLogo} 
                    alt="Fast Calories" 
                    style={{ height: isA3 ? '40px' : '28px' }}
                    crossOrigin="anonymous"
                  />
                  <div className="text-white">
                    <p 
                      className="font-bold leading-tight"
                      style={{ fontSize: isA3 ? '14px' : '9px' }}
                    >
                      Powered by Fast Calories
                    </p>
                    <p 
                      className="opacity-90"
                      style={{ fontSize: isA3 ? '11px' : '7px' }}
                    >
                      Eat Smart • Live Healthy
                    </p>
                  </div>
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
