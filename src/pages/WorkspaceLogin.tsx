import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Store, Truck, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';

interface WorkspaceInfo {
  workspace_id: string;
  workspace_type: string;
  workspace_name: string;
  logo_url: string | null;
}

export default function WorkspaceLogin() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  useEffect(() => {
    if (slug) resolveWorkspace();
  }, [slug]);

  const resolveWorkspace = async () => {
    try {
      // Use raw query since the RPC might not be in types yet
      const { data, error } = await supabase.rpc('resolve_workspace_slug' as any, {
        workspace_slug: slug!
      });

      if (error) throw error;
      
      if (data && Array.isArray(data) && data.length > 0) {
        setWorkspace(data[0] as WorkspaceInfo);
      } else {
        setNotFound(true);
      }
    } catch (error) {
      console.error('Error resolving workspace:', error);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !workspace) return;

    setIsLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Login failed');

      if (workspace.workspace_type === 'vendor') {
        // Verify vendor staff membership
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('id, role, is_active')
          .eq('user_id', authData.user.id)
          .eq('vendor_id', workspace.workspace_id)
          .eq('is_active', true)
          .maybeSingle();

        // Also check if they're the owner
        const { data: vendorOwner } = await supabase
          .from('vendors')
          .select('id')
          .eq('id', workspace.workspace_id)
          .eq('user_id', authData.user.id)
          .maybeSingle();

        if (!staffRecord && !vendorOwner) {
          await supabase.auth.signOut();
          throw new Error('You are not authorized to access this workspace');
        }

        toast({ title: 'Welcome!', description: `Signed in to ${workspace.workspace_name}` });
        navigate('/vendor/dashboard');
      } else if (workspace.workspace_type === 'delivery') {
        // Verify delivery company staff membership
        const { data: staffRecord } = await supabase
          .from('delivery_company_staff')
          .select('id, role, is_active')
          .eq('user_id', authData.user.id)
          .eq('delivery_company_id', workspace.workspace_id)
          .eq('is_active', true)
          .maybeSingle();

        const { data: companyOwner } = await supabase
          .from('delivery_companies')
          .select('id')
          .eq('id', workspace.workspace_id)
          .eq('user_id', authData.user.id)
          .maybeSingle();

        if (!staffRecord && !companyOwner) {
          await supabase.auth.signOut();
          throw new Error('You are not authorized to access this workspace');
        }

        toast({ title: 'Welcome!', description: `Signed in to ${workspace.workspace_name}` });
        navigate('/delivery/dashboard');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      toast({
        title: 'Login failed',
        description: error.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Workspace Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The workspace "{slug}" doesn't exist. Check the link and try again.
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const WorkspaceIcon = workspace?.workspace_type === 'delivery' ? Truck : Store;
  const platform = workspace?.workspace_type === 'vendor' ? 'vendor' : 'delivery';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            {workspace?.logo_url ? (
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-primary/20 shadow-lg">
                  <img src={workspace.logo_url} alt={workspace.workspace_name} className="w-full h-full object-cover" />
                </div>
              </div>
            ) : (
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center border-2 border-primary/20">
                  <WorkspaceIcon className="w-10 h-10 text-primary" />
                </div>
              </div>
            )}
            <CardTitle className="text-2xl">Welcome to {workspace?.workspace_name}</CardTitle>
            <CardDescription>Sign in to access your workspace</CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading} autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password" type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading} autoComplete="current-password" className="pr-10"
                  />
                  <button
                    type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button type="button" onClick={() => setShowForgotPassword(true)} className="text-sm text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...</> : 'Sign In'}
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-border">
              <div className="flex flex-col items-center gap-2">
                <img src={fastCaloriesLogo} alt="Fast Calories" className="h-8 opacity-70" />
                <p className="text-xs text-muted-foreground">Powered by Fast Calories</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <ForgotPasswordModal open={showForgotPassword} onOpenChange={setShowForgotPassword} platform={platform as any} />
      </div>
    </div>
  );
}
