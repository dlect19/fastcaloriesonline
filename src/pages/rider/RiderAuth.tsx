import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import riderLogo from '@/assets/rider-logo.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';
import { EmailVerificationOTP } from '@/components/rider/EmailVerificationOTP';
import { TermsAcceptanceCheckbox } from '@/components/auth/TermsAcceptanceCheckbox';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';

export default function RiderAuth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const redirectUrl = searchParams.get('redirect');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [ninNumber, setNinNumber] = useState('');

  // Google OAuth: complete rider profile after Google sign-in
  const [googleCompleteProfile, setGoogleCompleteProfile] = useState(false);
  const [googleUserId, setGoogleUserId] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState('');

  useEffect(() => {
    checkUser();
  }, []);

  // Listen for Google OAuth callback
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const user = session.user;
        const isOAuth = user.app_metadata?.provider === 'google';
        if (!isOAuth) return;

        // Check if already a rider
        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);

        if (roles?.some(r => r.role === 'rider')) {
          navigate(redirectUrl || '/rider/dashboard');
        } else {
          // Need to complete rider profile
          setGoogleUserId(user.id);
          setGoogleEmail(user.email || '');
          setFullName(user.user_metadata?.full_name || user.user_metadata?.name || '');
          setGoogleCompleteProfile(true);
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate, redirectUrl]);

  const handleGoogleCompleteRiderProfile = async () => {
    if (!googleUserId) return;
    if (!vehicleType) {
      toast({ title: 'Vehicle type required', variant: 'destructive' });
      return;
    }
    if (!ninNumber || !/^\d{11}$/.test(ninNumber)) {
      toast({ title: 'Valid 11-digit NIN required', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      // Add rider role
      await supabase.from('user_roles').insert({ user_id: googleUserId, role: 'rider' });

      // Create rider profile
      await supabase.from('rider_profiles').insert({
        user_id: googleUserId,
        vehicle_type: vehicleType,
        vehicle_plate: vehiclePlate || null,
        nin_number: ninNumber,
        nin_submitted_at: new Date().toISOString(),
        email: googleEmail,
      });

      // Update profile with phone
      if (phone) {
        await supabase.from('profiles').update({ phone, full_name: fullName }).eq('user_id', googleUserId);
      }

      // Update wallet type
      await supabase.from('wallets').update({ wallet_type: 'rider' }).eq('user_id', googleUserId);

      toast({ title: 'Registration successful!', description: 'Your account is pending admin verification.' });
      navigate(redirectUrl || '/rider/dashboard');
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
      
      if (roles?.some(r => r.role === 'rider')) {
        navigate(redirectUrl || '/rider/dashboard');
      }
    }
  };

  const validateNIN = (nin: string) => {
    // Nigerian NIN is 11 digits
    return /^\d{11}$/.test(nin);
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

      // Check if user has rider role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id);

      if (!roles?.some(r => r.role === 'rider')) {
        await supabase.auth.signOut();
        toast({
          title: 'Access denied',
          description: 'You do not have rider access. Please register as a rider.',
          variant: 'destructive',
        });
        return;
      }

      // Ensure rider_profile exists (fix for users who have rider role but no profile)
      const { data: existingProfile } = await supabase
        .from('rider_profiles')
        .select('id')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (!existingProfile) {
        await supabase.from('rider_profiles').insert({
          user_id: data.user.id,
          email: loginEmail,
        });
      } else {
        // Update email if missing
        const { data: profile } = await supabase
          .from('rider_profiles')
          .select('email')
          .eq('user_id', data.user.id)
          .maybeSingle();
        
        if (!profile?.email) {
          await supabase.from('rider_profiles')
            .update({ email: loginEmail })
            .eq('user_id', data.user.id);
        }
      }

      toast({ title: 'Welcome back!' });
      // Redirect to invite link if present, otherwise dashboard
      navigate(redirectUrl || '/rider/dashboard');
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

    if (!validateNIN(ninNumber)) {
      toast({
        title: 'Invalid NIN',
        description: 'Please enter a valid 11-digit National Identification Number',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // First, try to sign up as a new user
      const redirectUrl = `${window.location.origin}/rider/dashboard`;
      
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
          },
        },
      });

      if (error) {
        // If user already exists, try to sign in and add rider role
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: signupEmail,
            password: signupPassword,
          });

          if (signInError) {
            toast({
              title: 'Account exists',
              description: 'An account with this email already exists. Please login with your password.',
              variant: 'destructive',
            });
            return;
          }

          if (signInData.user) {
            // Check if already has rider role
            const { data: existingRoles } = await supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', signInData.user.id);

            if (existingRoles?.some(r => r.role === 'rider')) {
              // If the rider role already exists, still persist the NIN they entered.
              // This commonly happens for riders created via invitations who later try to "Sign Up".
              const { data: existingRiderProfile, error: existingRiderProfileError } = await supabase
                .from('rider_profiles')
                .select('id, nin_number, email')
                .eq('user_id', signInData.user.id)
                .maybeSingle();

              if (existingRiderProfileError) {
                console.error('Error checking rider profile:', existingRiderProfileError);
              }

              if (!existingRiderProfile) {
                await supabase.from('rider_profiles').insert({
                  user_id: signInData.user.id,
                  nin_number: ninNumber,
                  nin_submitted_at: new Date().toISOString(),
                  email: signupEmail,
                });
              } else if (!existingRiderProfile.nin_number) {
                await supabase
                  .from('rider_profiles')
                  .update({
                    nin_number: ninNumber,
                    nin_submitted_at: new Date().toISOString(),
                    email: signupEmail,
                  })
                  .eq('user_id', signInData.user.id);
              } else if (!existingRiderProfile.email) {
                // Update email if missing
                await supabase
                  .from('rider_profiles')
                  .update({ email: signupEmail })
                  .eq('user_id', signInData.user.id);
              }

              toast({ title: 'Welcome back!' });
              navigate(redirectUrl || '/rider/dashboard');
              return;
            }

            // Add rider role
            const { error: roleError } = await supabase.from('user_roles').insert({
              user_id: signInData.user.id,
              role: 'rider',
            });

            if (roleError) {
              console.error('Error adding rider role:', roleError);
              toast({
                title: 'Error adding rider access',
                description: 'Please contact support.',
                variant: 'destructive',
              });
              return;
            }

            // Create rider profile if not exists
            const { data: existingProfile } = await supabase
              .from('rider_profiles')
              .select('id')
              .eq('user_id', signInData.user.id)
              .maybeSingle();

            if (!existingProfile) {
              await supabase.from('rider_profiles').insert({
                user_id: signInData.user.id,
                vehicle_type: vehicleType,
                vehicle_plate: vehiclePlate,
                nin_number: ninNumber,
                nin_submitted_at: new Date().toISOString(),
                email: signupEmail,
              });
            } else {
              // Update existing profile with NIN and email
              await supabase.from('rider_profiles').update({
                nin_number: ninNumber,
                nin_submitted_at: new Date().toISOString(),
                email: signupEmail,
              }).eq('user_id', signInData.user.id);
            }

            // Update wallet type to rider for existing user upgrading to rider
            await supabase.from('wallets')
              .update({ wallet_type: 'rider' })
              .eq('user_id', signInData.user.id);

            // Show email verification
            setPendingUserId(signInData.user.id);
            setShowEmailVerification(true);
            return;
          }
        }
        throw error;
      }

      // New user created successfully
      if (data.user) {
        // Add rider role
        const { error: roleError } = await supabase.from('user_roles').insert({
          user_id: data.user.id,
          role: 'rider',
        });

        if (roleError) {
          console.error('Error adding rider role:', roleError);
        }

        // Create rider profile with NIN and email
        await supabase.from('rider_profiles').insert({
          user_id: data.user.id,
          vehicle_type: vehicleType,
          vehicle_plate: vehiclePlate,
          nin_number: ninNumber,
          nin_submitted_at: new Date().toISOString(),
          email: signupEmail,
        });

        // Create rider wallet with correct type
        await supabase.from('wallets')
          .update({ wallet_type: 'rider' })
          .eq('user_id', data.user.id);

        // Update profile with phone
        await supabase.from('profiles').update({ phone }).eq('user_id', data.user.id);

        // Show email verification
        setPendingUserId(data.user.id);
        setShowEmailVerification(true);
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

  const handleEmailVerified = () => {
    toast({
      title: 'Registration successful!',
      description: redirectUrl ? 'You can now join the vendor team!' : 'Your account is pending admin verification.',
    });
    // Redirect to invite link if present, otherwise dashboard
    navigate(redirectUrl || '/rider/dashboard');
  };

  if (showEmailVerification && pendingUserId) {
    return (
      <EmailVerificationOTP 
        email={signupEmail}
        userId={pendingUserId}
        platform="rider"
        onVerified={handleEmailVerified}
        onBack={() => setShowEmailVerification(false)}
      />
    );
  }

  // Google OAuth: show rider profile completion form
  if (googleCompleteProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img src={riderLogo} alt="Fast Calories Rider" className="w-24 h-24 object-contain" />
            </div>
            <CardTitle className="text-2xl">Complete Your Rider Profile</CardTitle>
            <CardDescription>
              Signed in as {googleEmail}. Please provide your rider details to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vehicle Type</Label>
                <Input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} placeholder="e.g., Motorcycle" required />
              </div>
              <div className="space-y-2">
                <Label>Plate Number <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} placeholder="N/A for bicycles" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                National Identification Number (NIN)
              </Label>
              <Input
                value={ninNumber}
                onChange={(e) => setNinNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="Enter 11-digit NIN"
                maxLength={11}
                required
              />
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Your NIN is required for security verification.</span>
              </div>
            </div>
            <Button className="w-full" onClick={handleGoogleCompleteRiderProfile} disabled={loading}>
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={riderLogo} alt="Fast Calories Rider" className="w-24 h-24 object-contain" />
          </div>
          <CardTitle className="text-2xl">Rider Portal</CardTitle>
          <CardDescription>
            {redirectUrl ? 'Sign in or create an account to join the team' : 'Deliver with Fast Calories'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={redirectUrl ? 'signup' : 'login'}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
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
                  <Label htmlFor="full-name">Full Name</Label>
                  <Input
                    id="full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
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
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-type">Vehicle Type</Label>
                    <Input
                      id="vehicle-type"
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value)}
                      placeholder="e.g., Motorcycle, Bicycle"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-plate">Plate Number <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input
                      id="vehicle-plate"
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value)}
                      placeholder="N/A for bicycles"
                    />
                  </div>
                </div>

                {/* NIN Field */}
                <div className="space-y-2">
                  <Label htmlFor="nin-number" className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    National Identification Number (NIN)
                  </Label>
                  <Input
                    id="nin-number"
                    value={ninNumber}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 11);
                      setNinNumber(value);
                    }}
                    placeholder="Enter 11-digit NIN"
                    maxLength={11}
                    required
                  />
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>Your NIN is required for security verification. It will be verified by our admin team before you can start receiving deliveries.</span>
                  </div>
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
                  Register as Rider
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ForgotPasswordModal 
        open={showForgotPassword} 
        onOpenChange={setShowForgotPassword}
        platform="rider"
      />
    </div>
  );
}
