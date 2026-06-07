import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { CheckCircle, XCircle, AlertCircle, Camera, Keyboard, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';

type VerifyResult = {
  result: 'valid' | 'already_used' | 'invalid' | 'unauthorized' | 'cancelled' | 'refunded' | 'expired';
  ticket?: any;
  event?: any;
};

export default function OrganizerVerify() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [eventName, setEventName] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<string>('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data } = await supabase.functions.invoke('organizer-event-data', { body: { token } });
      if (data?.event) setEventName(data.event.name);
    })();
  }, [token]);

  const verify = async (lookup: string) => {
    if (!lookup || busy || !token) return;
    if (lookup === lastScanRef.current) return;
    lastScanRef.current = lookup;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('organizer-verify-ticket', { body: { token, lookup } });
      if (error) setResult({ result: 'invalid' });
      else setResult(data as VerifyResult);
      setTimeout(() => { lastScanRef.current = ''; }, 2000);
    } finally { setBusy(false); }
  };

  const startScan = async () => {
    try {
      const q = new Html5Qrcode('organizer-qr-reader');
      scannerRef.current = q;
      await q.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, (decoded) => verify(decoded), () => {});
      setScanning(true);
    } catch (e) { console.error(e); }
  };
  const stopScan = async () => {
    try { await scannerRef.current?.stop(); await scannerRef.current?.clear(); } catch {}
    scannerRef.current = null;
    setScanning(false);
  };
  useEffect(() => () => { stopScan(); }, []);

  const colorClass = result?.result === 'valid' ? 'bg-green-500/10 text-green-600 border-green-500/30'
    : result?.result === 'already_used' ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
    : 'bg-destructive/10 text-destructive border-destructive/30';
  const icon = result?.result === 'valid' ? <CheckCircle className="w-12 h-12" />
    : result?.result === 'already_used' ? <AlertCircle className="w-12 h-12" />
    : <XCircle className="w-12 h-12" />;
  const label = result?.result === 'valid' ? 'VALID — Admitted'
    : result?.result === 'already_used' ? 'ALREADY USED'
    : result?.result === 'invalid' ? 'INVALID TICKET'
    : result?.result === 'unauthorized' ? 'WRONG EVENT'
    : result?.result?.toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to={`/organizer/${token}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <p className="text-sm font-semibold truncate">{eventName || 'Organizer Portal'}</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4">
        <h1 className="text-xl font-bold mb-1">Verify Tickets</h1>
        <p className="text-sm text-muted-foreground mb-4">Scan the QR or enter the ticket code.</p>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2"><Camera className="w-4 h-4" /><p className="font-semibold text-sm">Camera Scanner</p></div>
            <div id="organizer-qr-reader" className="rounded overflow-hidden bg-black" style={{ minHeight: scanning ? 280 : 0 }} />
            {!scanning ? <Button onClick={startScan} className="w-full mt-2">Start Camera</Button>
              : <Button variant="outline" onClick={stopScan} className="w-full mt-2">Stop Camera</Button>}
          </div>

          <div className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2"><Keyboard className="w-4 h-4" /><p className="font-semibold text-sm">Manual Entry</p></div>
            <div className="flex gap-2">
              <Input placeholder="FC-EVT-XXXX-XXXX" value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && verify(code)} />
              <Button onClick={() => verify(code)} disabled={busy || !code}>Verify</Button>
            </div>
          </div>

          {result && (
            <div className={`border-2 rounded-xl p-5 text-center ${colorClass}`}>
              <div className="flex justify-center mb-2">{icon}</div>
              <p className="text-lg font-bold">{label}</p>
              {result.event && <p className="text-sm mt-2 opacity-90">{result.event.name}</p>}
              {result.ticket && (
                <>
                  <p className="text-xs mt-1 opacity-75">Code: {result.ticket.ticket_code}</p>
                  {result.ticket.checked_in_at && <p className="text-xs opacity-75">Checked in: {new Date(result.ticket.checked_in_at).toLocaleString()}</p>}
                </>
              )}
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setResult(null); setCode(''); }}>Scan Next</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
