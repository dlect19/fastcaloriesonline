import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Mail, Lock, User, Phone, MapPin, Leaf, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export default function VendorAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Signup state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessCategory, setBusinessCategory] = useState<'restaurant' | 'pharmacy' | 'market'>('restaurant');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('Lagos');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) throw error;

      // Check if user has vendor role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id)
        .eq('role', 'vendor');

      if (!roles || roles.length === 0) {
        await supabase.auth.signOut();
        throw new Error('This account is not registered as a vendor');
      }

      toast({
        title: 'Welcome back!',
        description: 'Redirecting to your dashboard...',
      });

      navigate('/vendor/dashboard');
    } catch (error: any) {
      toast({
        title: 'Login failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate passwords match
    if (signupPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Please make sure your passwords match.',
        variant: 'destructive',
      });
      return;
    }

    if (signupPassword.length < 6) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/vendor/dashboard`,
          data: {
            full_name: fullName,
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create user');

      // Add vendor role
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: authData.user.id, role: 'vendor' });

      if (roleError) throw roleError;

      // Create vendor profile
      const { error: vendorError } = await supabase
        .from('vendors')
        .insert({
          user_id: authData.user.id,
          name: businessName,
          category: businessCategory,
          address: address,
          city: city,
          state: state,
          phone: phone,
          email: signupEmail,
          is_active: false, // Needs admin approval
        });

      if (vendorError) throw vendorError;

      toast({
        title: 'Registration successful!',
        description: 'Your vendor account is pending approval. You can still set up your menu.',
      });

      navigate('/vendor/dashboard');
    } catch (error: any) {
      toast({
        title: 'Registration failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-primary flex-col justify-center items-center p-12">
        <div className="max-w-md text-center">
          <div className="w-20 h-20 rounded-2xl bg-primary-foreground/10 flex items-center justify-center mx-auto mb-6">
            <Store className="w-10 h-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-primary-foreground mb-4">
            Fast Calories Vendor Portal
          </h1>
          <p className="text-primary-foreground/80 text-lg mb-8">
            Manage your menu, track orders, and grow your business with Nigeria's #1 health-aware delivery platform.
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-primary-foreground">50K+</p>
              <p className="text-sm text-primary-foreground/70">Active Users</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-primary-foreground">₦2M+</p>
              <p className="text-sm text-primary-foreground/70">Daily Orders</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-primary-foreground">15%</p>
              <p className="text-sm text-primary-foreground/70">Commission</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Leaf className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Fast Calories</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">
              {activeTab === 'login' ? 'Vendor Login' : 'Register Your Business'}
            </h2>
            <p className="text-muted-foreground mt-1">
              {activeTab === 'login'
                ? 'Access your vendor dashboard'
                : 'Join our network of vendors'}
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="vendor@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="login-password"
                      type={showLoginPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showLoginPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full h-12" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="full-name">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="full-name"
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="phone"
                        placeholder="08012345678"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="vendor@example.com"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="signup-password"
                      type={showSignupPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPassword(!showSignupPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showSignupPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-foreground mb-3">Business Information</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="business-name">Business Name</Label>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="business-name"
                        placeholder="My Restaurant"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={businessCategory} onValueChange={(v) => setBusinessCategory(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="restaurant">Restaurant</SelectItem>
                        <SelectItem value="pharmacy">Pharmacy</SelectItem>
                        <SelectItem value="market">Market</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Business Address</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="address"
                      placeholder="123 Main Street"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      placeholder="Lagos"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      placeholder="Lagos"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-12" disabled={loading}>
                  {loading ? 'Creating account...' : 'Create Vendor Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Looking to order food?{' '}
            <a href="/" className="text-primary hover:underline">
              Go to customer app
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
