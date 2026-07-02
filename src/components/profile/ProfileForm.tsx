import { useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User as UserIcon, Phone, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE, PHONE_LENGTH } from '@/lib/phoneValidation';
import type { Tables } from '@/integrations/supabase/types';
import { PhoneVerificationDialog } from '@/components/auth/PhoneVerificationDialog';

type Profile = Tables<'profiles'>;

interface ProfileFormProps {
  user: User;
  profile: Profile | null;
  onUpdate: () => void;
}

export function ProfileForm({ user, profile, onUpdate }: ProfileFormProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [pendingPhone, setPendingPhone] = useState('');
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
  });

  const phoneChanged = formData.phone.trim() !== (profile?.phone || '').trim();
  const isVerified = !!(profile as any)?.phone_verified;

  const handleSave = async () => {
    if (!isValidNgPhone(formData.phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: formData.full_name.trim() })
        .eq('user_id', user.id);
      if (error) throw error;

      if (phoneChanged) {
        setPendingPhone(formData.phone.trim());
        setVerifyOpen(true);
        toast({
          title: 'Verify your new number',
          description: 'Confirm your new number to update it. It must be your active WhatsApp number.',
        });
      } else {
        toast({ title: 'Success', description: 'Profile updated successfully' });
        setIsEditing(false);
        onUpdate();
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({ title: 'Error', description: 'Failed to update profile', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleVerified = () => {
    setVerifyOpen(false);
    setIsEditing(false);
    toast({ title: 'Phone updated ✅', description: 'Your new number is verified.' });
    onUpdate();
  };

  return (
    <Card className="border-border shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <UserIcon className="w-5 h-5 text-primary" />
          Personal Information
        </CardTitle>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full Name</Label>
          {isEditing ? (
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="Enter your full name"
            />
          ) : (
            <p className="text-foreground py-2">{profile?.full_name || 'Not set'}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          {isEditing ? (
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="phone"
                type="tel"
                inputMode="numeric"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: sanitizePhoneInput(e.target.value) })}
                placeholder="08012345678"
                className="pl-10"
                maxLength={PHONE_LENGTH}
                minLength={PHONE_LENGTH}
                pattern="\d{11}"
                title={PHONE_ERROR_MESSAGE}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <p className="text-foreground">{profile?.phone || 'Not set'}</p>
              {profile?.phone && (
                isVerified ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3 h-3" /> Verified
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setPendingPhone(profile.phone!); setVerifyOpen(true); }}
                    className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full hover:bg-amber-100"
                  >
                    <ShieldAlert className="w-3 h-3" /> Verify now
                  </button>
                )
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Email</Label>
          <p className="text-muted-foreground py-2">{user.email}</p>
        </div>

        {isEditing && (
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setIsEditing(false);
                setFormData({
                  full_name: profile?.full_name || '',
                  phone: profile?.phone || '',
                });
              }}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {phoneChanged ? 'Save & Verify Phone' : 'Save Changes'}
            </Button>
          </div>
        )}
      </CardContent>

      <PhoneVerificationDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        defaultPhone={pendingPhone || profile?.phone || ''}
        onVerified={handleVerified}
        title="Verify your new number"
      />
    </Card>
  );
}
