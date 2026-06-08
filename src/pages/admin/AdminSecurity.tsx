import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { ShieldCheck, KeyRound, Smartphone, Mail, Loader2, AlertTriangle, Trash2, CheckCircle2, Copy } from 'lucide-react';
import QRCode from 'qrcode';

interface Settings {
  preferred_method: 'email' | 'totp';
  totp_enabled: boolean;
  totp_enrolled_at: string | null;
  backup_codes: string[];
}

interface ActivityRow {
  id: string;
  ip: string | null;
  user_agent: string | null;
  was_new_device: boolean;
  created_at: string;
}

interface AttemptRow {
  id: string;
  email: string | null;
  outcome: string;
  failure_reason: string | null;
  ip: string | null;
  created_at: string;
}

interface LockoutRow {
  id: string;
  user_id: string;
  locked_until: string;
  reason: string | null;
  created_at: string;
}

export default function AdminSecurity() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isSuperAdmin, loading: permLoading } = useAdminPermissions();
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [lockouts, setLockouts] = useState<LockoutRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollQR, setEnrollQR] = useState<string | null>(null);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [disableCode, setDisableCode] = useState('');

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    setUserId(user.id);
    await refresh(user.id);
    setLoading(false);
  })(); }, []);

  const refresh = async (uid: string) => {
    const [s, a, at, l] = await Promise.all([
      supabase.from('admin_2fa_settings').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('admin_login_activity').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
      supabase.from('admin_login_attempts').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
      supabase.from('admin_lockouts').select('*').gt('locked_until', new Date().toISOString()).order('locked_until', { ascending: false }),
    ]);
    setSettings((s.data as any) || { preferred_method: 'email', totp_enabled: false, totp_enrolled_at: null, backup_codes: [] });
    setActivity((a.data as any) || []);
    setAttempts((at.data as any) || []);
    setLockouts((l.data as any) || []);
  };

  const startEnroll = async () => {
    setEnrolling(true);
    setBackupCodes(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-2fa-enroll-totp', { body: {} });
      if (error) throw error;
      setEnrollSecret(data.secret);
      const qr = await QRCode.toDataURL(data.otpauth_uri, { width: 240, margin: 1 });
      setEnrollQR(qr);
      setEnrollOpen(true);
    } catch (e: any) {
      toast({ title: 'Failed to start enrollment', description: e.message, variant: 'destructive' });
    } finally {
      setEnrolling(false);
    }
  };

  const confirmEnroll = async () => {
    if (enrollCode.length < 6) return;
    setEnrolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-2fa-confirm-totp', { body: { code: enrollCode } });
      if (error) throw error;
      if (!data.verified) {
        toast({ title: 'Invalid code', description: 'Check the time on your device and try again.', variant: 'destructive' });
        return;
      }
      setBackupCodes(data.backup_codes);
      toast({ title: 'Authenticator app enabled' });
      if (userId) await refresh(userId);
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setEnrolling(false);
    }
  };

  const disableTOTP = async () => {
    if (disableCode.length < 6) return;
    try {
      const { data, error } = await supabase.functions.invoke('admin-2fa-disable', { body: { code: disableCode } });
      if (error) throw error;
      if (!data.disabled) {
        toast({ title: 'Invalid code', variant: 'destructive' });
        return;
      }
      toast({ title: 'Authenticator app removed', description: 'You will receive sign-in codes by email.' });
      setDisableCode('');
      if (userId) await refresh(userId);
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const removeLockout = async (id: string) => {
    const { error } = await supabase.from('admin_lockouts').delete().eq('id', id);
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else if (userId) await refresh(userId);
  };

  if (permLoading || loading) {
    return <AdminLayout><div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AdminLayout>;
  }

  if (!isSuperAdmin) {
    return (
      <AdminLayout>
        <Card><CardContent className="py-12 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Two-factor authentication is required only for Super Admins.</p>
        </CardContent></Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-primary" /> Account Security</h1>
          <p className="text-sm text-muted-foreground">Two-factor authentication, sign-in activity and lockouts.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5" /> Two-Factor Authentication</CardTitle>
            <CardDescription>Choose how you confirm sign-ins to your admin account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/20">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 mt-0.5 text-primary" />
                <div>
                  <p className="font-medium">Email code</p>
                  <p className="text-sm text-muted-foreground">A 6-digit code is emailed to you every sign-in.</p>
                </div>
              </div>
              {!settings?.totp_enabled && <Badge className="bg-emerald-600">Active</Badge>}
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/20">
              <div className="flex items-start gap-3">
                <Smartphone className="w-5 h-5 mt-0.5 text-primary" />
                <div>
                  <p className="font-medium">Authenticator app (TOTP)</p>
                  <p className="text-sm text-muted-foreground">Google Authenticator, Authy, 1Password, etc. Works offline.</p>
                  {settings?.totp_enabled && settings.totp_enrolled_at && (
                    <p className="text-xs text-muted-foreground mt-1">Enrolled {new Date(settings.totp_enrolled_at).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
              {settings?.totp_enabled ? <Badge className="bg-emerald-600">Active</Badge> : <Button size="sm" onClick={startEnroll} disabled={enrolling}>Enroll</Button>}
            </div>

            {settings?.totp_enabled && (
              <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5 space-y-3">
                <p className="text-sm font-medium text-destructive">Remove authenticator app</p>
                <p className="text-xs text-muted-foreground">Enter your current 6-digit code to switch back to email codes.</p>
                <div className="flex gap-2">
                  <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className="font-mono" maxLength={6} />
                  <Button variant="destructive" onClick={disableTOTP} disabled={disableCode.length < 6}>Remove</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="activity">
          <TabsList>
            <TabsTrigger value="activity">Sign-in activity</TabsTrigger>
            <TabsTrigger value="attempts">All attempts</TabsTrigger>
            <TabsTrigger value="lockouts">Active lockouts {lockouts.length > 0 && <Badge variant="destructive" className="ml-2">{lockouts.length}</Badge>}</TabsTrigger>
          </TabsList>

          <TabsContent value="activity">
            <Card><CardContent className="pt-6">
              {activity.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No activity yet.</p> : (
                <div className="space-y-2">
                  {activity.map(a => (
                    <div key={a.id} className="flex items-start justify-between p-3 rounded border text-sm">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                        <div>
                          <p className="font-medium">{new Date(a.created_at).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{a.ip ?? 'unknown IP'} · {(a.user_agent || '').slice(0, 80)}</p>
                        </div>
                      </div>
                      {a.was_new_device && <Badge variant="outline" className="text-amber-600 border-amber-600">New device</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="attempts">
            <Card><CardContent className="pt-6">
              {attempts.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No attempts logged.</p> : (
                <div className="space-y-2">
                  {attempts.map(a => (
                    <div key={a.id} className="flex items-start justify-between p-3 rounded border text-sm">
                      <div>
                        <p className="font-medium">{new Date(a.created_at).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{a.ip ?? '—'}{a.failure_reason ? ` · ${a.failure_reason}` : ''}</p>
                      </div>
                      <Badge variant={a.outcome === 'success' ? 'default' : 'destructive'}>{a.outcome}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="lockouts">
            <Card><CardContent className="pt-6">
              {lockouts.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No active lockouts.</p> : (
                <div className="space-y-2">
                  {lockouts.map(l => (
                    <div key={l.id} className="flex items-center justify-between p-3 rounded border text-sm bg-destructive/5">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
                        <div>
                          <p className="font-medium">User {l.user_id.slice(0, 8)}…</p>
                          <p className="text-xs text-muted-foreground">Locked until {new Date(l.locked_until).toLocaleString()} · {l.reason}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => removeLockout(l.id)}><Trash2 className="w-3 h-3 mr-1" />Unlock</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={enrollOpen} onOpenChange={(o) => { setEnrollOpen(o); if (!o) { setEnrollCode(''); setBackupCodes(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{backupCodes ? 'Save your backup codes' : 'Set up authenticator app'}</DialogTitle>
            <DialogDescription>
              {backupCodes ? 'Store these somewhere safe. Each code can be used once if you lose your device.' : 'Scan the QR code with Google Authenticator, Authy, or any TOTP app.'}
            </DialogDescription>
          </DialogHeader>

          {backupCodes ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted p-3 rounded">
                {backupCodes.map(c => <div key={c} className="px-2 py-1 bg-background rounded text-center">{c}</div>)}
              </div>
              <Button className="w-full" onClick={() => { navigator.clipboard.writeText(backupCodes.join('\n')); toast({ title: 'Copied' }); }}>
                <Copy className="w-4 h-4 mr-2" />Copy all codes
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setEnrollOpen(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {enrollQR && <div className="flex justify-center"><img src={enrollQR} alt="QR" className="rounded border" /></div>}
              {enrollSecret && (
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded select-all break-all">{enrollSecret}</code>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Enter the 6-digit code from your app</label>
                <Input value={enrollCode} onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className="text-center text-xl tracking-widest font-mono" maxLength={6} />
              </div>
              <Button className="w-full" onClick={confirmEnroll} disabled={enrolling || enrollCode.length < 6}>
                {enrolling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Verify & enable
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
