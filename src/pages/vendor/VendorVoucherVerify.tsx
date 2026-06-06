import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { CheckCircle, XCircle, AlertCircle, Camera, Keyboard, Loader2 } from 'lucide-react';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useVendorResolver } from '@/hooks/useVendorResolver';

type Result = {
  ok: boolean;
  status: string;
  message?: string;
  voucher_code?: string;
  reward_type?: string;
  combo_id?: string | null;
  redeemed_at?: string;
};

export default function VendorVoucherVerify() {
  const { vendorId, loading: vendorLoading } = useVendorResolver();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef('');

  const verify = async (lookup: string) => {
    if (!lookup || busy || !vendorId) return;
    if (lookup === lastScanRef.current) return;
    lastScanRef.current = lookup;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-event-voucher', {
        body: { lookup, vendor_id: vendorId },
      });
      setResult(error ? { ok: false, status: 'INVALID' } : (data as Result));
      setTimeout(() => { lastScanRef.current = ''; }, 2000);
    } finally { setBusy(false); }
  };

  const startScan = async () => {
    try {
      const q = new Html5Qrcode('voucher-qr-reader');
      scannerRef.current = q;
      await q.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, (d) => verify(d), () => {});
      setScanning(true);
    } catch (e) { console.error(e); }
  };

  const stopScan = async () => {
    try { await scannerRef.current?.stop(); await scannerRef.current?.clear(); } catch {}
    scannerRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => { stopScan(); }, []);

  const ok = result?.ok;
  const colorClass = ok ? 'bg-green-500/10 text-green-600 border-green-500/30'
    : result?.status === 'ALREADY_REDEEMED' ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
    : 'bg-destructive/10 text-destructive border-destructive/30';
  const icon = ok ? <CheckCircle className="w-12 h-12" />
    : result?.status === 'ALREADY_REDEEMED' ? <AlertCircle className="w-12 h-12" />
    : <XCircle className="w-12 h-12" />;
  const label = ok ? 'REDEEMED — Hand over food'
    : result?.status === 'ALREADY_REDEEMED' ? 'ALREADY REDEEMED'
    : result?.status === 'WRONG_VENDOR' ? 'NOT FOR THIS VENDOR'
    : result?.status?.split('_').join(' ');

  if (vendorLoading) {
    return <VendorLayout><div className="flex items-center justify-center py-20"><Loader2 className="animate-spin" /></div></VendorLayout>;
  }
  if (!vendorId) {
    return <VendorLayout><p className="text-sm text-muted-foreground">No vendor context.</p></VendorLayout>;
  }

  return (
    <VendorLayout>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-1">Food Voucher Verification</h1>
        <p className="text-sm text-muted-foreground mb-6">Scan or enter a customer's voucher code to redeem at this outlet.</p>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2"><Camera className="w-4 h-4" /><p className="font-semibold text-sm">Camera Scanner</p></div>
            <div id="voucher-qr-reader" className="rounded overflow-hidden bg-black" style={{ minHeight: scanning ? 280 : 0 }} />
            {!scanning ? (
              <Button onClick={startScan} className="w-full mt-2">Start Camera</Button>
            ) : (
              <Button variant="outline" onClick={stopScan} className="w-full mt-2">Stop Camera</Button>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2"><Keyboard className="w-4 h-4" /><p className="font-semibold text-sm">Manual Entry</p></div>
            <div className="flex gap-2">
              <Input placeholder="FC-VCH-XXXX-XXXX" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && verify(code)} />
              <Button onClick={() => verify(code)} disabled={busy || !code}>Verify</Button>
            </div>
          </div>

          {result && (
            <div className={`border-2 rounded-xl p-5 text-center ${colorClass}`}>
              <div className="flex justify-center mb-2">{icon}</div>
              <p className="text-lg font-bold">{label}</p>
              {result.voucher_code && <p className="text-xs mt-1 opacity-75">Code: {result.voucher_code}</p>}
              {result.redeemed_at && <p className="text-xs opacity-75">Redeemed: {new Date(result.redeemed_at).toLocaleString()}</p>}
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setResult(null); setCode(''); }}>Scan Next</Button>
            </div>
          )}
        </div>
      </div>
    </VendorLayout>
  );
}
