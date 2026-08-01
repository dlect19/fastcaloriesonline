import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { MessageCircle, Save, Loader2 } from 'lucide-react';

interface Props {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function WhatsAppAuthSettings({ settings, onSettingChange, onSave, saving }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          WhatsApp Authentication
        </CardTitle>
        <CardDescription>
          Control whether customers can sign in or sign up with their WhatsApp number (6-digit OTP).
          Both are OFF by default — email/password authentication is unaffected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
          <div className="space-y-1">
            <Label className="text-sm">Enable WhatsApp Login</Label>
            <p className="text-xs text-muted-foreground">
              Shows "Continue with WhatsApp number" on the sign-in screen.
            </p>
          </div>
          <Switch
            checked={settings['whatsapp_login_enabled'] === 'true'}
            onCheckedChange={c => onSettingChange('whatsapp_login_enabled', c ? 'true' : 'false')}
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
          <div className="space-y-1">
            <Label className="text-sm">Enable WhatsApp Sign Up</Label>
            <p className="text-xs text-muted-foreground">
              Shows "Sign up with WhatsApp number" on the create-account screen.
            </p>
          </div>
          <Switch
            checked={settings['whatsapp_signup_enabled'] === 'true'}
            onCheckedChange={c => onSettingChange('whatsapp_signup_enabled', c ? 'true' : 'false')}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : <><Save className="w-4 h-4 mr-2" /> Save Settings</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
