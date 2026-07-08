import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Mail, Lock, User, ArrowRight, Loader2, Eye, EyeOff, Gift } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import customerAppImg from '@/assets/landing-customer-app.png';
import vendorRestaurantImg from '@/assets/landing-vendor-restaurant.png';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';
import { TermsAcceptanceCheckbox } from '@/components/auth/TermsAcceptanceCheckbox';
import { EmailVerificationOTP } from '@/components/rider/EmailVerificationOTP';
import { PhoneAuthModal } from '@/components/auth/PhoneAuthModal';
import { MessageCircle } from 'lucide-react';



const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');
const nameSchema = z.string().min(2, 'Name must be at least 2 characters');

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; name?: string; confirmPassword?: string }>({});
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPreSignupOTP, setShowPreSignupOTP] = useState(false);
  const [showPhoneAuth, setShowPhoneAuth] = useState(false);

  // Pre-fill referral code from URL
  const urlRef = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref') || '';
  }, []);

  useEffect(() => {
    if (urlRef) {
      setReferralCode(urlRef);
      setIsLogin(false);
    }
  }, [urlRef]);

  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string; name?: string; confirmPassword?: string } = {};
    
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      newErrors.email = emailResult.error.errors[0].message;
    }

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      newErrors.password = passwordResult.error.errors[0].message;
    }

    if (!isLogin) {
      const nameResult = nameSchema.safeParse(fullName);
      if (!nameResult.success) {
        newErrors.name = nameResult.error.errors[0].message;
      }

      // Confirm password validation
      if (password !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      } else if (!confirmPassword) {
        newErrors.confirmPassword = 'Please confirm your password';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    if (!isLogin && !termsAccepted) {
      toast({
        title: 'Agreement required',
        description: 'You must agree to the Terms & Conditions before continuing.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast({
              title: 'Login failed',
              description: 'Invalid email or password. Please try again.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Login failed',
              description: error.message,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Welcome back!',
            description: 'You have successfully logged in.',
          });
        }
      } else {
        // For signup: verify email FIRST before creating account
        setShowPreSignupOTP(true);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailVerified = async () => {
    // Email verified — now create the account
    setIsLoading(true);
    try {
      const { error } = await signUp(email, password, fullName);
      if (error) {
        if (error.message.includes('User already registered')) {
          toast({
            title: 'Account exists',
            description: 'An account with this email already exists. Please login instead.',
            variant: 'destructive',
          });
          setIsLogin(true);
          setShowPreSignupOTP(false);
        } else {
          toast({
            title: 'Sign up failed',
            description: error.message,
            variant: 'destructive',
          });
        }
      } else {
        // Store referral code linkage if provided (check both customer referrals AND ambassador promo codes)
        if (referralCode.trim()) {
          try {
            // First check customer referral codes
            const { data: referrerProfile } = await supabase
              .from('profiles')
              .select('id')
              .ilike('referral_code', referralCode.trim())
              .single();

            if (referrerProfile) {
              localStorage.setItem('fc_referral_code', referralCode.trim());
              localStorage.setItem('fc_referral_type', 'customer');
            } else {
              // Check ambassador promo codes
              const { data: ambassador } = await supabase
                .from('ambassadors')
                .select('id, promo_code')
                .ilike('promo_code', referralCode.trim())
                .eq('is_active', true)
                .single();

              if (ambassador) {
                localStorage.setItem('fc_referral_code', referralCode.trim());
                localStorage.setItem('fc_referral_type', 'ambassador');
                localStorage.setItem('fc_ambassador_id', ambassador.id);

                // Record ambassador registration for tracking
                const { data: { user: currentUser } } = await supabase.auth.getUser();
                if (currentUser) {
                  await supabase.from('ambassador_registrations').insert({
                    ambassador_id: ambassador.id,
                    user_id: currentUser.id,
                    promo_code_used: referralCode.trim(),
                  });
                }
              }
            }
          } catch {
            // Ignore invalid referral/promo codes silently
          }
        }

        toast({
          title: 'Account created!',
          description: 'Your email has been verified and your account is ready.',
        });
        setShowPreSignupOTP(false);
        navigate('/');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMode = () => {
    setIsLogin(!isLogin);
    setErrors({});
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setTermsAccepted(false);
    if (!urlRef) setReferralCode('');
  };

  if (showPreSignupOTP) {
    return (
      <EmailVerificationOTP
        email={email}
        platform="customer"
        onVerified={handleEmailVerified}
        onBack={() => setShowPreSignupOTP(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary to-background flex flex-col">
      {/* Header with images */}
      <div className="flex flex-col items-center pt-8 pb-4">
        <div className="flex items-center justify-center gap-3 mb-4">
          <img src={vendorRestaurantImg} alt="Order food online" className="w-24 h-20 sm:w-32 sm:h-24 object-cover rounded-xl shadow-card" />
          <img src={fastCaloriesLogo} alt="Fast Calories" className="h-14 w-auto" />
          <img src={customerAppImg} alt="Fast Calories app" className="w-20 h-28 sm:w-24 sm:h-32 object-cover rounded-xl shadow-card" />
        </div>
        <p className="text-xs text-muted-foreground">Eat Smart. Live Healthy.</p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {isLogin ? 'Welcome back' : 'Create account'}
            </h1>
            <p className="text-muted-foreground">
              {isLogin 
                ? 'Sign in to continue ordering healthy meals' 
                : 'Join Fast Calories for health-aware food delivery'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-sm font-medium">
                  Full Name
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="pl-10 h-12 bg-card border-border"
                    disabled={isLoading}
                  />
                </div>
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12 bg-card border-border"
                  disabled={isLoading}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-12 bg-card border-border"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                  <p className="text-sm text-destructive">{errors.password}</p>
                )}
                {isLogin && (
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>

            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10 h-12 bg-card border-border"
                    disabled={isLoading}
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
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">{errors.confirmPassword}</p>
                )}
              </div>
            )}

            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="referralCode" className="text-sm font-medium">
                  Referral / Promo Code (Optional)
                </Label>
                <div className="relative">
                  <Gift className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="referralCode"
                    type="text"
                    placeholder="e.g. FC-john1234 or ambassador code"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    className="pl-10 h-12 bg-card border-border"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {!isLogin && (
              <TermsAcceptanceCheckbox
                accepted={termsAccepted}
                onAcceptedChange={setTermsAccepted}
                disabled={isLoading}
              />
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold shadow-button"
              disabled={isLoading || (!isLogin && !termsAccepted)}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </form>


          {/* Toggle */}
          <div className="mt-8 text-center">
            <p className="text-muted-foreground">
              {isLogin ? "Don't have an account?" : 'Already have an account?'}
              <button
                type="button"
                onClick={handleToggleMode}
                className="ml-2 text-primary font-semibold hover:underline"
                disabled={isLoading}
              >
                {isLogin ? 'Sign Up' : 'Sign In'}
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pb-8 px-6">
        <p className="text-sm text-muted-foreground">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>

      <ForgotPasswordModal 
        open={showForgotPassword} 
        onOpenChange={setShowForgotPassword}
        platform="customer"
      />
    </div>
  );
}
