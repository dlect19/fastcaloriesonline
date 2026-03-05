import { useState } from "react";
import { useNavigate } from 'react-router-dom';
import { Store, Mail, Lock, User, Phone, MapPin, Eye, EyeOff, Link2 } from 'lucide-react';
import { StoreTypeField, type StoreType, type SocialMediaHandles } from '@/components/vendor/StoreTypeField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';
import { TermsAcceptanceCheckbox } from '@/components/auth/TermsAcceptanceCheckbox';

type AuthTab = 'login' | 'signup' | 'link';

export default function VendorAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

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
  const [storeType, setStoreType] = useState<StoreType>('physical');
  const [socialHandles, setSocialHandles] = useState<SocialMediaHandles>({});

  // Link account state
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [showLinkPassword, setShowLinkPassword] = useState(false);
  const [linkBusinessName, setLinkBusinessName] = useState('');
  const [linkBusinessCategory, setLinkBusinessCategory] = useState<'restaurant' | 'pharmacy' | 'market'>('restaurant');
  const [linkAddress, setLinkAddress] = useState('');
  const [linkCity, setLinkCity] = useState('');
  const [linkState, setLinkState] = useState('Lagos');
  const [linkPhone, setLinkPhone] = useState('');
  const [linkStoreType, setLinkStoreType] = useState<StoreType>('physical');
  const [linkSocialHandles, setLinkSocialHandles] = useState<SocialMediaHandles>({});

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
        throw new Error('This account is not registered as a vendor. Use "Link Account" if you want to add vendor access to your existing customer account.');
      }

      // Check if vendor profile exists (use limit(1) to handle multiple profiles)
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id')
        .eq('user_id', data.user.id)
        .limit(1);

      if (!vendors || vendors.length === 0) {
        // Has vendor role but no profile - rare edge case
        await supabase.auth.signOut();
        throw new Error('Vendor profile not found. Please contact support.');
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

    if (!termsAccepted) {
      toast({
        title: 'Agreement required',
        description: 'You must agree to the Terms & Conditions before continuing.',
        variant: 'destructive',
      });
      return;
    }
    
    
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

      if (authError) {
        // Check if user already exists
        if (authError.message.includes('User already registered')) {
          toast({
            title: 'Account already exists',
            description: 'An account with this email already exists. Use "Link Account" to add vendor access to your existing account.',
            variant: 'destructive',
          });
          // Pre-fill the link form with the email
          setLinkEmail(signupEmail);
          setLinkBusinessName(businessName);
          setLinkBusinessCategory(businessCategory);
          setLinkAddress(address);
          setLinkCity(city);
          setLinkState(state);
          setLinkPhone(phone);
          setActiveTab('link');
          return;
        }
        throw authError;
      }
      
      if (!authData.user) throw new Error('Failed to create user');

      // Add vendor role using the new function
      const { error: roleError } = await supabase.rpc('add_vendor_role');

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
          is_active: false,
          store_type: storeType,
          social_media_handles: socialHandles,
        } as any);

      if (vendorError) throw vendorError;

      // Send custom verification email via edge function
      try {
        const verificationUrl = `${window.location.origin}/verify-email`;
        await supabase.functions.invoke('send-verification-email', {
          body: {
            email: signupEmail,
            verificationUrl,
            userName: fullName,
            platform: 'vendor',
          },
        });
      } catch (emailError) {
        console.error('Failed to send custom verification email:', emailError);
      }

      // Navigate to verification pending page
      navigate('/verification-pending', {
        state: { email: signupEmail, platform: 'vendor' },
      });
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

  const handleLinkAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Sign in with existing account
      const { data, error } = await supabase.auth.signInWithPassword({
        email: linkEmail,
        password: linkPassword,
      });

      if (error) throw error;

      // Check if already a vendor (use limit(1) to handle multiple profiles)
      const { data: existingVendors } = await supabase
        .from('vendors')
        .select('id')
        .eq('user_id', data.user.id)
        .limit(1);

      if (existingVendors && existingVendors.length > 0) {
        toast({
          title: 'Already a vendor',
          description: 'This account is already registered as a vendor.',
        });
        navigate('/vendor/dashboard');
        return;
      }

      // Add vendor role using the new function
      const { error: roleError } = await supabase.rpc('add_vendor_role');

      if (roleError) throw roleError;

      // Create vendor profile
      const { error: vendorError } = await supabase
        .from('vendors')
        .insert({
          user_id: data.user.id,
          name: linkBusinessName,
          category: linkBusinessCategory,
          address: linkAddress,
          city: linkCity,
          state: linkState,
          phone: linkPhone || null,
          email: linkEmail,
          is_active: false,
          store_type: linkStoreType,
          social_media_handles: linkSocialHandles,
        } as any);

      if (vendorError) throw vendorError;

      toast({
        title: 'Vendor account created!',
        description: 'Your vendor profile has been set up successfully. Redirecting to dashboard...',
      });

      navigate('/vendor/dashboard');
    } catch (error: any) {
      toast({
        title: 'Failed to link account',
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
          <div className="w-24 h-24 rounded-2xl bg-primary-foreground flex items-center justify-center mx-auto mb-6 p-2">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-full h-full object-contain" />
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
      <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="h-14 w-auto" />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">
              {activeTab === 'login' && 'Vendor Login'}
              {activeTab === 'signup' && 'Register Your Business'}
              {activeTab === 'link' && 'Link Existing Account'}
            </h2>
            <p className="text-muted-foreground mt-1">
              {activeTab === 'login' && 'Access your vendor dashboard'}
              {activeTab === 'signup' && 'Join our network of vendors'}
              {activeTab === 'link' && 'Add vendor access to your customer account'}
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AuthTab)}>
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
              <TabsTrigger value="link" className="flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                Link
              </TabsTrigger>
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
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
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

                <StoreTypeField
                  storeType={storeType}
                  onStoreTypeChange={setStoreType}
                  socialHandles={socialHandles}
                  onSocialHandlesChange={setSocialHandles}
                  compact
                />

                <div className="space-y-2">
                  <Label htmlFor="address">Business Address {storeType === 'online' ? '(Optional)' : ''}</Label>
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

                <TermsAcceptanceCheckbox
                  accepted={termsAccepted}
                  onAcceptedChange={setTermsAccepted}
                  disabled={loading}
                />

                <Button type="submit" className="w-full h-12" disabled={loading || !termsAccepted}>
                  {loading ? 'Creating account...' : 'Create Vendor Account'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="link">
              <div className="mb-4 p-4 bg-primary/10 border border-primary/20 rounded-xl">
                <div className="flex items-start gap-3">
                  <Link2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Already have a customer account?</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Sign in with your existing Fast Calories account to add vendor access. You'll be able to use both the customer app and vendor portal with the same login.
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleLinkAccount} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="link-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="link-email"
                      type="email"
                      placeholder="your@email.com"
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="link-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="link-password"
                      type={showLinkPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={linkPassword}
                      onChange={(e) => setLinkPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowLinkPassword(!showLinkPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showLinkPassword ? (
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
                    <Label htmlFor="link-business-name">Business Name</Label>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="link-business-name"
                        placeholder="My Restaurant"
                        value={linkBusinessName}
                        onChange={(e) => setLinkBusinessName(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={linkBusinessCategory} onValueChange={(v) => setLinkBusinessCategory(v as any)}>
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

                <StoreTypeField
                  storeType={linkStoreType}
                  onStoreTypeChange={setLinkStoreType}
                  socialHandles={linkSocialHandles}
                  onSocialHandlesChange={setLinkSocialHandles}
                  compact
                />

                <div className="space-y-2">
                  <Label htmlFor="link-address">Business Address {linkStoreType === 'online' ? '(Optional)' : ''}</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="link-address"
                      placeholder="123 Main Street"
                      value={linkAddress}
                      onChange={(e) => setLinkAddress(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="link-city">City</Label>
                    <Input
                      id="link-city"
                      placeholder="Lagos"
                      value={linkCity}
                      onChange={(e) => setLinkCity(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="link-state">State</Label>
                    <Input
                      id="link-state"
                      placeholder="Lagos"
                      value={linkState}
                      onChange={(e) => setLinkState(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="link-phone">Phone (Optional)</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="link-phone"
                      placeholder="08012345678"
                      value={linkPhone}
                      onChange={(e) => setLinkPhone(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-12" disabled={loading}>
                  {loading ? 'Linking account...' : 'Link Account & Create Vendor Profile'}
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

      <ForgotPasswordModal 
        open={showForgotPassword} 
        onOpenChange={setShowForgotPassword}
        platform="vendor"
      />
    </div>
  );
}
