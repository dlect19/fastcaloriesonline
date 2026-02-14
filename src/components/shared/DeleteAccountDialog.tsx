import { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DeleteAccountDialogProps {
  userId: string;
  userEmail: string;
  onDeleted: () => void;
}

export function DeleteAccountDialog({ userId, userEmail, onDeleted }: DeleteAccountDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSubmit = async () => {
    if (confirmText !== 'DELETE') return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('account_deletion_requests')
        .insert({
          user_id: userId,
          reason: reason.trim() || null,
        });

      if (error) throw error;

      toast({
        title: 'Deletion Request Submitted',
        description: 'Your account deletion request has been submitted. You will be notified when it is processed.',
      });

      setOpen(false);
      onDeleted();
    } catch (error: any) {
      console.error('Error submitting deletion request:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to submit deletion request',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="gap-2">
          <Trash2 className="w-4 h-4" />
          Delete My Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Delete Account
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              This action will submit a request to permanently delete your account 
              (<strong>{userEmail}</strong>) and all associated data. This cannot be undone.
            </p>
            <p className="text-destructive font-medium">
              All your orders, wallet balance, earnings, and profile data will be permanently removed.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for leaving (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell us why you're leaving..."
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Type <strong>DELETE</strong> to confirm</Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="DELETE"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={confirmText !== 'DELETE' || submitting}
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Submitting...</>
            ) : (
              'Permanently Delete Account'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
