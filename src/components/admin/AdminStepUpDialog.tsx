import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { requestStepUpToken, STEP_UP_LABELS, type StepUpRequest } from '@/lib/adminSecurity';

interface PendingRequest extends StepUpRequest {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}

/**
 * useAdminStepUp — gate any sensitive admin action behind a fresh authenticator code.
 *
 *   const { requireStepUp, stepUpDialog } = useAdminStepUp();
 *   const token = await requireStepUp({ action: 'wallet_debit', targetType: 'wallet', targetId: walletId });
 */
export function useAdminStepUp() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  pendingRef.current = pending;

  useEffect(() => () => pendingRef.current?.reject(new Error('step_up_cancelled')), []);

  const requireStepUp = useCallback((req: StepUpRequest) => {
    return new Promise<string>((resolve, reject) => {
      setPending({ ...req, resolve, reject });
    });
  }, []);

  const stepUpDialog = (
    <AdminStepUpDialog
      request={pending}
      onClose={() => setPending(null)}
    />
  );

  return { requireStepUp, stepUpDialog };
}

function AdminStepUpDialog({ request, onClose }: { request: PendingRequest | null; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request) {
      setCode('');
      setError(null);
    }
  }, [request]);

  const cancel = () => {
    request?.reject(new Error('step_up_cancelled'));
    onClose();
  };

  const submit = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const token = await requestStepUpToken(request, code);
      request.resolve(token);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const notEnrolled = !!error && error.toLowerCase().includes('not enrolled');

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" /> Authenticator required
          </DialogTitle>
          <DialogDescription>
            Enter the current 6-digit code from your authenticator app to approve:{' '}
            <span className="font-medium text-foreground">
              {request?.label || (request ? STEP_UP_LABELS[request.action] : '')}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="step-up-code">Authenticator code</Label>
            <Input
              id="step-up-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="text-center text-xl tracking-[0.5em] font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6 && !busy) submit(); }}
              autoFocus
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <ShieldAlert className="w-4 h-4" />
              <AlertDescription className="text-xs">
                {error}
                {notEnrolled && (
                  <>
                    {' '}
                    <Link to="/admin/security" className="underline font-medium" onClick={cancel}>
                      Set up your authenticator app
                    </Link>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          <p className="text-[11px] text-muted-foreground">
            Codes are single-use and verified on the server. This approval expires in 3 minutes.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AdminStepUpDialog;
