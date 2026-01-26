import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';

interface VendorInfo {
  id: string;
  name: string;
  logo_url: string | null;
}

export default function VendorStaffLogin() {
  const { vendorId } = useParams<{ vendorId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [loadingVendor, setLoadingVendor] = useState(true);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  useEffect(() => {
    if (vendorId) {
      fetchVendor();
    } else {
      setLoadingVendor(false);
    }
  }, [vendorId]);

  const fetchVendor = async () => {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name, logo_url')
        .eq('id', vendorId)
        .maybeSingle();

      if (error) throw error;
      setVendor(data);
    } catch (error) {
      console.error('Error fetching vendor:', error);
    } finally {
      setLoadingVendor(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: 'Missing fields',
        description: 'Please enter both email and password',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      // Sign in with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        throw authError;
      }

      if (!authData.user) {
        throw new Error('Login failed');
      }

      // If vendorId is provided, verify this user is staff for this vendor
      if (vendorId) {
        const { data: staffRecord, error: staffError } = await supabase
          .from('vendor_staff')
          .select('id, role, is_active')
          .eq('user_id', authData.user.id)
          .eq('vendor_id', vendorId)
          .eq('is_active', true)
          .maybeSingle();

        if (staffError || !staffRecord) {
          // Sign them out since they're not authorized for this vendor
          await supabase.auth.signOut();
          throw new Error('You are not authorized to access this vendor workspace');
        }

        toast({
          title: 'Welcome back!',
          description: `Logged in as ${staffRecord.role}`,
        });
      } else {
        // No vendorId - check if they have any vendor staff record
        const { data: anyStaffRecord, error: anyStaffError } = await supabase
          .from('vendor_staff')
          .select('id, vendor_id, role, is_active')
          .eq('user_id', authData.user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (anyStaffError || !anyStaffRecord) {
          await supabase.auth.signOut();
          throw new Error('No active staff assignment found for your account');
        }

        toast({
          title: 'Welcome back!',
          description: `Logged in as ${anyStaffRecord.role}`,
        });
      }

      navigate('/vendor/dashboard');
    } catch (error: unknown) {
      console.error('Login error:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      toast({
        title: 'Login failed',
        description: errorMessage === 'Invalid login credentials' 
          ? 'Incorrect email or password. Please check your credentials and try again.'
          : errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (loadingVendor) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            {/* Vendor Logo */}
            {vendor?.logo_url ? (
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-primary/20 shadow-lg">
                  <img
                    src={vendor.logo_url}
                    alt={vendor.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ) : (
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center border-2 border-primary/20">
                  <Store className="w-10 h-10 text-primary" />
                </div>
              </div>
            )}
            
            <CardTitle className="text-2xl">
              {vendor ? `Welcome to ${vendor.name}` : 'Staff Login'}
            </CardTitle>
            <CardDescription>
              Sign in to access the vendor workspace
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Fast Calories Branding */}
            <div className="mt-8 pt-6 border-t border-border">
              <div className="flex flex-col items-center gap-2">
                <img
                  src={fastCaloriesLogo}
                  alt="Fast Calories"
                  className="h-8 opacity-70"
                />
                <p className="text-xs text-muted-foreground">
                  Powered by Fast Calories
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <ForgotPasswordModal 
          open={showForgotPassword} 
          onOpenChange={setShowForgotPassword}
          platform="vendor"
        />
      </div>
    </div>
  );
}
