import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarHeart, Loader2, Mail, Lock, User, Phone, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function OrganizerAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [busy, setBusy] = useState(false);

  // login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // signup
  const [sEmail, setSEmail] = useState('');
  const [sPassword, setSPassword] = useState('');
  const [sName, setSName] = useState('');
  const [sBrand, setSBrand] = useState('');
  const [sPhone, setSPhone] = useState('');

  // If already logged in AND already linked to an organizer, go to dashboard
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: org } = await supabase
        .from('event_organizers').select('id').eq('owner_user_id', session.user.id).maybeSingle();
      if (org?.id) navigate('/organizer/dashboard', { replace: true });
    })();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { toast({ title: 'Login failed', description: error.message, variant: 'destructive' }); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: org } = await supabase
      .from('event_organizers').select('id, is_active').eq('owner_user_id', user.id).maybeSingle();
    if (!org) {
      toast({ title: 'No organizer profile', description: 'This account is not linked to an event organizer. Sign up first or contact admin.', variant: 'destructive' });
      return;
    }
    navigate('/organizer/dashboard');
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sBrand.trim() || !sName.trim()) {
      toast({ title: 'Missing details', description: 'Provide your name and brand/organizer name.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    const redirectUrl = `${window.location.origin}/organizer/dashboard`;
    const { data: signUpRes, error } = await supabase.auth.signUp({
      email: sEmail.trim(),
      password: sPassword,
      options: {
        emailRedirectTo: redirectUrl,
        data: { full_name: sName, role_hint: 'event_organizer' },
      },
    });
    if (error) { setBusy(false); toast({ title: 'Signup failed', description: error.message, variant: 'destructive' }); return; }
    const userId = signUpRes.user?.id;
    if (!userId) { setBusy(false); toast({ title: 'Check your email', description: 'Confirm your email then log in.' }); setTab('login'); return; }

    // Create pending organizer profile linked to this user
    const { error: orgErr } = await supabase.from('event_organizers').insert({
      name: sBrand.trim(),
      contact_email: sEmail.trim(),
      contact_phone: sPhone.trim() || null,
      owner_user_id: userId,
      is_active: false,
      is_verified: false,
    });
    setBusy(false);
    if (orgErr) { toast({ title: 'Profile error', description: orgErr.message, variant: 'destructive' }); return; }

    toast({ title: 'Account created', description: 'Your organizer profile is pending admin approval. You can log in to track status.' });
    navigate('/organizer/dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-3">
            <CalendarHeart className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold">Event Planner Portal</h1>
          <p className="text-sm text-muted-foreground">Sell tickets, track sales & withdraw earnings</p>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'signup')}>
            <TabsList className="grid grid-cols-2 mb-5">
              <TabsTrigger value="login">Log In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-3">
                <Field label="Email" icon={Mail}>
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" />
                </Field>
                <Field label="Password" icon={Lock}>
                  <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Log In
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-3">
                <Field label="Your Name" icon={User}>
                  <Input required value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Jane Doe" />
                </Field>
                <Field label="Brand / Organizer Name" icon={Building2}>
                  <Input required value={sBrand} onChange={(e) => setSBrand(e.target.value)} placeholder="Lagos Live Events" />
                </Field>
                <Field label="Email" icon={Mail}>
                  <Input type="email" required value={sEmail} onChange={(e) => setSEmail(e.target.value)} placeholder="you@brand.com" />
                </Field>
                <Field label="Phone" icon={Phone}>
                  <Input type="tel" value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="+234 800 000 0000" />
                </Field>
                <Field label="Password" icon={Lock}>
                  <Input type="password" required minLength={8} value={sPassword} onChange={(e) => setSPassword(e.target.value)} placeholder="8+ characters" />
                </Field>
                <p className="text-[11px] text-muted-foreground">
                  By signing up you agree that your organizer profile will be reviewed by Fast Calories admin before going live.
                </p>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Create Account
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Looking for the customer app? <a className="text-primary underline" href="/">Open Fast Calories</a>
        </p>
      </div>
    </div>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}</Label>
      {children}
    </div>
  );
}
