import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE, PHONE_LENGTH } from '@/lib/phoneValidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, Truck, Building2 } from 'lucide-react';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';
import { TermsAcceptanceCheckbox } from '@/components/auth/TermsAcceptanceCheckbox';
import { EmailVerificationOTP } from '@/components/rider/EmailVerificationOTP';


export default function DeliveryCompanyAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPreSignupOTP, setShowPreSignupOTP] = useState(false);

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [address, setAddress] = useState('');

  // Link existing customer account
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [showLinkPassword, setShowLinkPassword] = useState(false);
  const [linkCompanyName, setLinkCompanyName] = useState('');
  const [linkPhone, setLinkPhone] = useState('');
  const [linkCity, setLinkCity] = useState('');
  const [linkState, setLinkState] = useState('');
  const [linkAddress, setLinkAddress] = useState('');

  // Google OAuth: complete company profile after Google sign-in
  const [googleCompleteProfile, setGoogleCompleteProfile] = useState(false);
  const [googleUserId, setGoogleUserId] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState('');

  useEffect(() => {
    checkUser();
  }, []);

  // Listen for Google OAuth callback
  useEffect(() => {
    const handleGoogleOAuthState = async (user: any) => {
      try {
        const isOAuth = user.app_metadata?.provider === 'google';
        if (!isOAuth) return;

        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);

        if (roles?.some(r => r.role === 'delivery_company')) {
          navigate('/delivery/dashboard');
        } else {
          setGoogleUserId(user.id);
          setGoogleEmail(user.email || '');
          setOwnerName(user.user_metadata?.full_name || user.user_metadata?.name || '');
          setGoogleCompleteProfile(true);
        }
      } catch (error: any) {
        toast({ title: 'Google sign-in check failed', description: error.message || 'Please try again', variant: 'destructive' });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        void handleGoogleOAuthState(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, toast]);

  const handleGoogleCompleteCompanyProfile = async () => {
    if (!googleUserId) return;
    if (!companyName || !phone || !city || !state) {
      toast({ title: 'All fields required', description: 'Please fill all company details.', variant: 'destructive' });
      return;
    }
    if (!isValidNgPhone(phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      // Add delivery_company role
      await supabase.from('user_roles').insert({ user_id: googleUserId, role: 'delivery_company' });

      // Create delivery company
      await supabase.from('delivery_companies').insert({
        user_id: googleUserId,
        name: companyName,
        email: googleEmail,
        phone,
        city,
        state,
        address,
      });

      // Update profile
      await supabase.from('profiles').update({ phone, full_name: ownerName }).eq('user_id', googleUserId);

      toast({ title: 'Registration successful!', description: 'Your company is pending admin verification.' });
      navigate('/delivery/dashboard');
    } catch (error: any) {
      toast({ title: 'Registration failed', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      
      if (roles?.some(r => r.role === 'delivery_company')) {
        navigate('/delivery/dashboard');
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) throw error;

      // Check if user has delivery_company role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id);

      if (!roles?.some(r => r.role === 'delivery_company')) {
        await supabase.auth.signOut();
        toast({
          title: 'Access denied',
          description: 'You do not have delivery company access. Please register your company.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Welcome back!' });
      navigate('/delivery/dashboard');
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
    
    
    if (signupPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Please ensure both passwords are identical',
        variant: 'destructive',
      });
      return;
    }

    if (signupPassword.length < 6) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 6 characters',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidNgPhone(phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }

    // Show pre-signup OTP verification
    setShowPreSignupOTP(true);
  };

  const proceedWithDeliverySignup = async () => {
    setLoading(true);
    try {
      // First, try to sign up as a new user
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/delivery/dashboard`,
          data: {
            full_name: ownerName,
          },
        },
      });

      if (error) {
        // If user already exists, try to sign them in and add the role
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          // Try to sign in with the provided credentials
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: signupEmail,
            password: signupPassword,
          });

          if (signInError) {
            toast({
              title: 'Account exists',
              description: 'An account with this email exists. Please login with your existing password or use "Forgot Password" to reset it.',
              variant: 'destructive',
            });
            return;
          }

          if (signInData.user) {
            // Check if already a delivery company
            const { data: existingRoles } = await supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', signInData.user.id);

            if (existingRoles?.some(r => r.role === 'delivery_company')) {
              toast({
                title: 'Already registered',
                description: 'Your company is already registered. Redirecting to dashboard.',
              });
              navigate('/delivery/dashboard');
              return;
            }

            // Add delivery_company role to existing user
            await supabase.from('user_roles').insert({
              user_id: signInData.user.id,
              role: 'delivery_company',
            });

            // Create delivery company record
            await supabase.from('delivery_companies').insert({
              user_id: signInData.user.id,
              name: companyName,
              email: signupEmail,
              phone,
              city,
              state,
              address,
            });

            // Update profile
            await supabase.from('profiles').update({ 
              phone, 
              full_name: ownerName 
            }).eq('user_id', signInData.user.id);

            toast({
              title: 'Company registered!',
              description: 'Your delivery company has been created and linked to your existing account. Pending admin verification.',
            });
            navigate('/delivery/dashboard');
            return;
          }
        }
        throw error;
      }

      if (data.user) {
        // Add delivery_company role
        const { error: roleError } = await supabase.from('user_roles').insert({
          user_id: data.user.id,
          role: 'delivery_company',
        });

        if (roleError) {
          console.error('Error adding role:', roleError);
        }

        // Create delivery company record
        const { error: companyError } = await supabase.from('delivery_companies').insert({
          user_id: data.user.id,
          name: companyName,
          email: signupEmail,
          phone,
          city,
          state,
          address,
        });

        if (companyError) {
          console.error('Error creating company:', companyError);
        }

        // Update profile with phone
        await supabase.from('profiles').update({ 
          phone, 
          full_name: ownerName 
        }).eq('user_id', data.user.id);

        toast({
          title: 'Registration successful!',
          description: 'Your company is pending admin verification. Please check your email to verify your account.',
        });
        navigate('/delivery/dashboard');
      }
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

  if (showPreSignupOTP) {
    return (
      <EmailVerificationOTP
        email={signupEmail}
        platform="delivery_company"
        onVerified={() => { setShowPreSignupOTP(false); proceedWithDeliverySignup(); }}
        onBack={() => setShowPreSignupOTP(false)}
      />
    );
  }

  // Google OAuth: show company profile completion form
  if (googleCompleteProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <img src={fastCaloriesLogo} alt="Fast Calories" className="w-20 h-20 object-contain" />
                <div className="absolute -bottom-1 -right-1 bg-primary rounded-full p-1">
                  <Truck className="w-4 h-4 text-primary-foreground" />
                </div>
              </div>
            </div>
            <CardTitle className="text-2xl">Complete Company Registration</CardTitle>
            <CardDescription>Signed in as {googleEmail}. Please provide your company details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Building2 className="w-4 h-4" />Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g., Swift Logistics Ltd" required />
            </div>
            <div className="space-y-2">
              <Label>Owner/Manager Name</Label>
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))} required maxLength={PHONE_LENGTH} pattern="\d{11}" placeholder="08012345678" title={PHONE_ERROR_MESSAGE} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input value={state} onChange={(e) => setState(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Business Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Office address" required />
            </div>
            <Button className="w-full" onClick={handleGoogleCompleteCompanyProfile} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Complete Registration
            </Button>
            <Button variant="ghost" className="w-full" onClick={async () => {
              await supabase.auth.signOut();
              setGoogleCompleteProfile(false);
            }}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-primary flex-col justify-center items-center p-12">
        <div className="max-w-md text-center">
          <div className="w-24 h-24 rounded-2xl bg-primary-foreground flex items-center justify-center mx-auto mb-6 p-2">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-primary-foreground mb-4">
            Fast Calories Logistics Portal
          </h1>
          <p className="text-primary-foreground/80 text-lg mb-8">
            Partner with Nigeria's #1 health-aware delivery platform and grow your fleet.
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
              <p className="text-2xl font-bold text-primary-foreground">Fleet</p>
              <p className="text-sm text-primary-foreground/70">Management</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel - auth card */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <img src={fastCaloriesLogo} alt="Fast Calories" className="w-20 h-20 object-contain" />
              <div className="absolute -bottom-1 -right-1 bg-primary rounded-full p-1">
                <Truck className="w-4 h-4 text-primary-foreground" />
              </div>
            </div>
          </div>
          <CardTitle className="text-2xl">Logistics Partner Portal</CardTitle>
          <CardDescription>
            Partner with Fast Calories to provide delivery services
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Register</TabsTrigger>
              <TabsTrigger value="link">Link</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Login
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company-name" className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Company Name
                  </Label>
                  <Input
                    id="company-name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g., Swift Logistics Ltd"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-name">Owner/Manager Name</Label>
                  <Input
                    id="owner-name"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Business Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
                    required
                    maxLength={PHONE_LENGTH}
                    minLength={PHONE_LENGTH}
                    pattern="\d{11}"
                    placeholder="08012345678"
                    title={PHONE_ERROR_MESSAGE}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Business Address</Label>
                  <Input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Office address"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <TermsAcceptanceCheckbox
                  accepted={termsAccepted}
                  onAcceptedChange={setTermsAccepted}
                  disabled={loading}
                />
                <Button type="submit" className="w-full" disabled={loading || !termsAccepted}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Register Company
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="link">
              <div className="mb-3 rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
                Already have a Fast Calories account? Sign in and register your delivery company without creating a new account. Profile will still be reviewed by admin.
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!isValidNgPhone(linkPhone)) {
                    toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
                    return;
                  }
                  if (!linkCompanyName || !linkCity || !linkState) {
                    toast({ title: 'All fields required', variant: 'destructive' });
                    return;
                  }
                  setLoading(true);
                  try {
                    const { data, error } = await supabase.auth.signInWithPassword({ email: linkEmail, password: linkPassword });
                    if (error) throw error;
                    const { data: existing } = await supabase.from('delivery_companies').select('id').eq('user_id', data.user.id).limit(1);
                    if (existing && existing.length > 0) {
                      toast({ title: 'Already registered', description: 'This account already has a delivery company.' });
                      navigate('/delivery/dashboard');
                      return;
                    }
                    const { error: roleErr } = await supabase.rpc('add_delivery_company_role');
                    if (roleErr) throw roleErr;
                    const { error: insErr } = await supabase.from('delivery_companies').insert({
                      user_id: data.user.id,
                      name: linkCompanyName,
                      email: linkEmail,
                      phone: linkPhone,
                      city: linkCity,
                      state: linkState,
                      address: linkAddress,
                    });
                    if (insErr) throw insErr;
                    toast({ title: 'Company registered!', description: 'Pending admin verification.' });
                    navigate('/delivery/dashboard');
                  } catch (err: any) {
                    toast({ title: 'Failed to link account', description: err.message, variant: 'destructive' });
                  } finally {
                    setLoading(false);
                  }
                }}
                className="space-y-4"
              >
                <div className="space-y-2"><Label>Email</Label><Input type="email" required value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} /></div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <div className="relative">
                    <Input type={showLinkPassword ? 'text' : 'password'} required value={linkPassword} onChange={(e) => setLinkPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowLinkPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showLinkPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2"><Label className="flex items-center gap-2"><Building2 className="w-4 h-4" />Company Name</Label><Input required value={linkCompanyName} onChange={(e) => setLinkCompanyName(e.target.value)} placeholder="Swift Logistics Ltd" /></div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input type="tel" inputMode="numeric" required value={linkPhone} onChange={(e) => setLinkPhone(sanitizePhoneInput(e.target.value))} maxLength={PHONE_LENGTH} pattern="\d{11}" placeholder="08012345678" title={PHONE_ERROR_MESSAGE} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>City</Label><Input required value={linkCity} onChange={(e) => setLinkCity(e.target.value)} /></div>
                  <div className="space-y-2"><Label>State</Label><Input required value={linkState} onChange={(e) => setLinkState(e.target.value)} /></div>
                </div>
                <div className="space-y-2"><Label>Business Address</Label><Input required value={linkAddress} onChange={(e) => setLinkAddress(e.target.value)} /></div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Link Account & Register Company
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      </div>

      <ForgotPasswordModal
        open={showForgotPassword}
        onOpenChange={setShowForgotPassword}
        platform="vendor"
      />
    </div>
  );
}
