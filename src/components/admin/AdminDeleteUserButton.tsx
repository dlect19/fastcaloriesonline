import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminStepUp } from '@/components/admin/AdminStepUpDialog';

type Scope = 'customer' | 'vendor' | 'rider' | 'delivery_company' | 'all';

interface AdminDeleteUserButtonProps {
  userId: string | null | undefined;
  scope: Scope;
  entityName: string;
  buttonLabel?: string;
  size?: 'sm' | 'default' | 'icon';
  variant?: 'destructive' | 'outline' | 'ghost';
  onDeleted?: () => void;
}

const SCOPE_COPY: Record<Scope, { title: string; desc: string }> = {
  customer: {
    title: 'Remove customer role',
    desc: 'Removes the customer role. Other roles on this account stay intact.',
  },
  vendor: {
    title: 'Remove vendor account',
    desc: 'Deletes the vendor business and removes the vendor role. Their customer/rider access (if any) stays intact.',
  },
  rider: {
    title: 'Remove rider account',
    desc: 'Deletes the rider profile and removes the rider role.',
  },
  delivery_company: {
    title: 'Remove logistics company',
    desc: 'Deletes the delivery company and removes the logistics role.',
  },
  all: {
    title: 'Delete entire account',
    desc: 'Permanently deletes the user, all their roles and login. This cannot be undone.',
  },
};

export function AdminDeleteUserButton({
  userId,
  scope,
  entityName,
  buttonLabel,
  size = 'sm',
  variant = 'outline',
  onDeleted,
}: AdminDeleteUserButtonProps) {
  const { toast } = useToast();
  const { requireStepUp, stepUpDialog } = useAdminStepUp();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const copy = SCOPE_COPY[scope];
  const needsConfirmText = scope === 'all';

  const handleDelete = async () => {
    if (!userId) {
      toast({ title: 'Missing user', variant: 'destructive' });
      return;
    }
    if (needsConfirmText && confirm !== 'DELETE') {
      toast({ title: 'Type DELETE to confirm', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const stepUpToken = await requireStepUp({
        action: 'user_delete',
        targetType: 'user',
        targetId: userId,
        label: `${copy.title} — ${entityName}`,
      });
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId, scope, reason: reason || null, stepUpToken },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Deleted', description: `${entityName} removed (${scope})` });
      setOpen(false);
      setConfirm('');
      setReason('');
      onDeleted?.();
    } catch (err: any) {
      if (err?.message === 'step_up_cancelled') { setLoading(false); return; }
      toast({
        title: 'Delete failed',
        description: err.message || 'Unable to delete',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {stepUpDialog}
      <AlertDialogTrigger asChild>
        <Button
          size={size}
          variant={variant}
          className={variant === 'outline' ? 'text-destructive border-destructive hover:bg-destructive/10' : undefined}
          disabled={!userId}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          {buttonLabel ?? 'Delete'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.desc}
            <br />
            <span className="font-medium text-foreground mt-2 inline-block">
              Target: {entityName}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="del-reason">Reason (logged for audit)</Label>
            <Input
              id="del-reason"
              placeholder="e.g. Registered in wrong portal"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {needsConfirmText && (
            <div className="space-y-1">
              <Label htmlFor="del-confirm">Type DELETE to confirm</Label>
              <Input
                id="del-confirm"
                placeholder="DELETE"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
