import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

interface InviteDetails {
  id: string;
  role: string;
  invite_email: string;
}

export default function AdminStaffJoin() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  
  // For signup
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (code) {
      fetchInvite();
    }
  }, [code]);

  const fetchInvite = async () => {
    try {
      // Look up the invite by code
      const { data: staffInvite, error: inviteError } = await supabase
        .from('admin_staff')
        .select('id, role, invite_email, invite_code, invite_accepted_at, is_active, user_id')
        .filter('invite_code', 'eq', code)
        .maybeSingle();

      if (inviteError) throw inviteError;
      
      const inviteData = staffInvite as any;
      
      if (!inviteData) {
        setError('Invalid or expired invite link');
        setLoading(false);
        return;
      }

      if (inviteData.invite_accepted_at) {
        setError('This invite has already been used');
        setLoading(false);
        return;
      }

      setInvite({
        id: inviteData.id,
        role: inviteData.role,
        invite_email: inviteData.invite_email || ''
      });
      
      setEmail(inviteData.invite_email || '');
    } catch (err) {
      console.error('Error fetching invite:', err);
      setError('Failed to load invite details');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvite = async () => {
    if (!invite) return;

    // If user is logged in, directly accept
    if (user) {
      await linkUserToAdmin(user.id);
      return;
    }

    // If not logged in and trying to sign up
    if (isSignUp) {
      if (password !== confirmPassword) {
        toast({ title: 'Passwords do not match', variant: 'destructive' });
        return;
      }
      if (password.length < 6) {
        toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
        return;
      }
      
      setJoining(true);
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/admin/staff/join/${code}`,
            data: { full_name: fullName }
          }
        });

        if (error) throw error;

        if (data.user) {
          await linkUserToAdmin(data.user.id);
        } else {
          toast({ title: 'Check your email to confirm your account' });
        }
      } catch (err: any) {
        toast({ title: 'Error creating account', description: err.message, variant: 'destructive' });
      } finally {
        setJoining(false);
      }
      return;
    }

    // If not logged in and trying to sign in
    setJoining(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (data.user) {
        await linkUserToAdmin(data.user.id);
      }
    } catch (err: any) {
      toast({ title: 'Login failed', description: err.message, variant: 'destructive' });
    } finally {
      setJoining(false);
    }
  };

  const linkUserToAdmin = async (userId: string) => {
    if (!invite) return;

    setJoining(true);
    try {
      // Add admin role to user_roles
      await supabase
        .from('user_roles')
        .upsert({ user_id: userId, role: 'admin' }, { onConflict: 'user_id,role' });

      // Update the admin_staff record with the user's ID and mark as accepted
      const { error } = await supabase
        .from('admin_staff')
        .update({
          user_id: userId,
          invite_accepted_at: new Date().toISOString(),
          is_active: true
        })
        .eq('id', invite.id);

      if (error) throw error;

      toast({ title: 'Welcome to the admin team!' });
      navigate('/admin/dashboard');
    } catch (err: any) {
      console.error('Error accepting invite:', err);
      toast({ title: 'Failed to join', description: err.message, variant: 'destructive' });
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invite</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" onClick={() => navigate('/')}>
              Go Home
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
          <img src={fastCaloriesLogo} alt="Fast Calories" className="w-16 h-16 mx-auto mb-4" />
          <CardTitle className="flex items-center justify-center gap-2">
            <Shield className="w-5 h-5" />
            Join Admin Team
          </CardTitle>
          <CardDescription>
            You've been invited to join as
            <Badge className="ml-2 capitalize">{invite?.role?.replace('_', ' ')}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user ? (
            // User is already logged in
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-secondary text-center">
                <CheckCircle className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="font-medium">Logged in as</p>
                <p className="text-muted-foreground">{user.email}</p>
              </div>
              <Button className="w-full" onClick={handleAcceptInvite} disabled={joining}>
                {joining && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Accept Invitation
              </Button>
            </div>
          ) : (
            // User needs to login or signup
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button 
                  variant={!isSignUp ? "default" : "outline"} 
                  className="flex-1"
                  onClick={() => setIsSignUp(false)}
                >
                  Sign In
                </Button>
                <Button 
                  variant={isSignUp ? "default" : "outline"} 
                  className="flex-1"
                  onClick={() => setIsSignUp(true)}
                >
                  Create Account
                </Button>
              </div>

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              )}

              <Button className="w-full" onClick={handleAcceptInvite} disabled={joining}>
                {joining && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {isSignUp ? 'Create Account & Join' : 'Sign In & Join'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
