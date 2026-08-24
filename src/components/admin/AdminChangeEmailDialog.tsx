import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Mail, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAdminStepUp } from '@/components/admin/AdminStepUpDialog';

interface AdminChangeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName: string;
}

export function AdminChangeEmailDialog({ open, onOpenChange, userId, userName }: AdminChangeEmailDialogProps) {
  const { toast } = useToast();
  const { requireStepUp, stepUpDialog } = useAdminStepUp();
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!userId || !newEmail.trim()) {
      toast({ title: 'Missing info', description: 'Enter a new email address', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const stepUpToken = await requireStepUp({
        action: 'user_email_change',
        targetType: 'user',
        targetId: userId,
        label: `Change login email for ${userName}`,
      });
      const res = await supabase.functions.invoke('admin-update-user-email', {
        body: { userId, newEmail: newEmail.trim(), stepUpToken },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast({
        title: 'Email Updated',
        description: `Login email for ${userName} changed to ${newEmail.trim()}`,
      });

      onOpenChange(false);
      setNewEmail('');
    } catch (err: any) {
      if (err?.message === 'step_up_cancelled') { setLoading(false); return; }
      toast({ title: 'Error', description: err.message || 'Failed to update email', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setNewEmail(''); }}>
      {stepUpDialog}
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Change Login Email
          </DialogTitle>
          <DialogDescription>
            Update the login email for <strong>{userName}</strong>. The new email will be auto-confirmed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-email">New Email Address</Label>
            <Input
              id="new-email"
              type="email"
              placeholder="Enter new email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !newEmail.trim()}>
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating...</>
            ) : (
              'Update Email'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
