import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarHeart, Loader2, Mail, Lock, User, Phone, Building2, Eye, EyeOff, Ticket, Wallet, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

export default function OrganizerAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<'login' | 'signup' | 'link'>('login');
  const [busy, setBusy] = useState(false);

  // link state
  const [lEmail, setLEmail] = useState('');
  const [lPassword, setLPassword] = useState('');
  const [showLPwd, setShowLPwd] = useState(false);
  const [lBrand, setLBrand] = useState('');
  const [lPhone, setLPhone] = useState('');

  // login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);

  // signup
  const [sEmail, setSEmail] = useState('');
  const [sPassword, setSPassword] = useState('');
  const [sPassword2, setSPassword2] = useState('');
  const [showSPwd, setShowSPwd] = useState(false);
  const [showSPwd2, setShowSPwd2] = useState(false);
  const [sName, setSName] = useState('');
  const [sBrand, setSBrand] = useState('');
  const [sPhone, setSPhone] = useState('');

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
    if (sPassword !== sPassword2) {
      toast({ title: 'Passwords do not match', description: 'Confirm password must match.', variant: 'destructive' });
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

    toast({ title: 'Account created', description: 'Your organizer profile is pending admin approval.' });
    navigate('/organizer/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-primary flex-col justify-center items-center p-12 relative overflow-hidden">
        <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-96 h-96 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="max-w-md text-center relative z-10">
          <div className="w-24 h-24 rounded-2xl bg-primary-foreground flex items-center justify-center mx-auto mb-6 p-2">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-primary-foreground mb-3">
            Fast Calories Events
          </h1>
          <p className="text-primary-foreground/80 text-lg mb-8">
            Sell tickets, run promos, and withdraw earnings — all from one organizer dashboard.
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-primary-foreground/10 rounded-xl p-3 backdrop-blur-sm">
              <Ticket className="w-6 h-6 text-primary-foreground mx-auto mb-1" />
              <p className="text-xs text-primary-foreground/80">Tickets & Vouchers</p>
            </div>
            <div className="bg-primary-foreground/10 rounded-xl p-3 backdrop-blur-sm">
              <Wallet className="w-6 h-6 text-primary-foreground mx-auto mb-1" />
              <p className="text-xs text-primary-foreground/80">Instant Wallet</p>
            </div>
            <div className="bg-primary-foreground/10 rounded-xl p-3 backdrop-blur-sm">
              <TrendingUp className="w-6 h-6 text-primary-foreground mx-auto mb-1" />
              <p className="text-xs text-primary-foreground/80">Live Sales</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-6 lg:hidden">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="h-12 w-auto" />
          </div>

          <div className="mb-6">
            <div className="inline-flex items-center gap-2 text-primary mb-2">
              <CalendarHeart className="w-5 h-5" />
              <span className="text-sm font-medium">Event Planner Portal</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              {tab === 'login' ? 'Welcome back' : 'Create your organizer account'}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {tab === 'login' ? 'Access your event dashboard' : 'Start selling tickets in minutes'}
            </p>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'signup')}>
            <TabsList className="grid grid-cols-2 mb-5 w-full">
              <TabsTrigger value="login">Log In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-3">
                <Field label="Email" icon={Mail}>
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" />
                </Field>
                <Field label="Password" icon={Lock}>
                  <div className="relative">
                    <Input
                      type={showLoginPwd ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showLoginPwd ? 'Hide password' : 'Show password'}
                    >
                      {showLoginPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
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
                  <div className="relative">
                    <Input
                      type={showSPwd ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={sPassword}
                      onChange={(e) => setSPassword(e.target.value)}
                      placeholder="8+ characters"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showSPwd ? 'Hide password' : 'Show password'}
                    >
                      {showSPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="Confirm Password" icon={Lock}>
                  <div className="relative">
                    <Input
                      type={showSPwd2 ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={sPassword2}
                      onChange={(e) => setSPassword2(e.target.value)}
                      placeholder="Re-enter password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSPwd2(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showSPwd2 ? 'Hide password' : 'Show password'}
                    >
                      {showSPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {sPassword2.length > 0 && sPassword !== sPassword2 && (
                    <p className="text-[11px] text-destructive">Passwords do not match</p>
                  )}
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

          <p className="text-center text-xs text-muted-foreground mt-6">
            Looking for the customer app? <a className="text-primary underline" href="/">Open Fast Calories</a>
          </p>
        </div>
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
