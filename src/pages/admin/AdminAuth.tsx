import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, Shield } from 'lucide-react';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';
import { Admin2FAChallenge } from '@/components/admin/Admin2FAChallenge';

type Stage = 'password' | '2fa';

export default function AdminAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [stage, setStage] = useState<Stage>('password');
  const [twoFAMethod, setTwoFAMethod] = useState<'email' | 'totp'>('email');

  useEffect(() => { checkUser(); }, []);

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
      if (roles?.some(r => r.role === 'admin')) {
        // Already signed in — but only navigate if there's a 2fa session marker
        if (sessionStorage.getItem('admin_2fa_passed') === user.id) {
          navigate('/admin/dashboard');
        }
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', data.user.id);
      if (!roles?.some(r => r.role === 'admin')) {
        await supabase.auth.signOut();
        toast({ title: 'Access denied', description: 'You do not have admin privileges.', variant: 'destructive' });
        return;
      }

      // Initiate 2FA
      const { data: init, error: initErr } = await supabase.functions.invoke('admin-2fa-initiate', { body: {} });
      if (initErr) throw initErr;

      if (!init?.required) {
        // Non-super admin: skip 2FA
        sessionStorage.setItem('admin_2fa_passed', data.user.id);
        toast({ title: 'Welcome, Admin!' });
        navigate('/admin/dashboard');
        return;
      }
      if (init.locked) {
        await supabase.auth.signOut();
        toast({ title: 'Account locked', description: `Try again after ${new Date(init.locked_until).toLocaleTimeString()}`, variant: 'destructive' });
        return;
      }
      setTwoFAMethod(init.method);
      setStage('2fa');
    } catch (error: any) {
      toast({ title: 'Login failed', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const onCancel2FA = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem('admin_2fa_passed');
    setStage('password');
    setPassword('');
  };

  const onVerified = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) sessionStorage.setItem('admin_2fa_passed', user.id);
    toast({ title: 'Welcome, Admin!' });
    navigate('/admin/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <img src={fastCaloriesLogo} alt="Fast Calories" className="w-16 h-16 object-contain" />
              <Shield className="w-6 h-6 text-primary absolute -bottom-1 -right-1" />
            </div>
          </div>
          <CardTitle className="text-2xl">Admin Portal</CardTitle>
          <CardDescription>{stage === 'password' ? 'Secure access for administrators only' : 'Confirm it\'s you'}</CardDescription>
        </CardHeader>
        <CardContent>
          {stage === 'password' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button type="button" onClick={() => setShowForgotPassword(true)} className="text-sm text-primary hover:underline">Forgot password?</button>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
                Admin Login
              </Button>
            </form>
          ) : (
            <Admin2FAChallenge method={twoFAMethod} emailHint={email} onVerified={onVerified} onCancel={onCancel2FA} />
          )}
        </CardContent>
      </Card>

      <ForgotPasswordModal open={showForgotPassword} onOpenChange={setShowForgotPassword} platform="admin" />
    </div>
  );
}
