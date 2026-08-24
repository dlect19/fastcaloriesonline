import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, X, Plus, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAdminStepUp } from '@/components/admin/AdminStepUpDialog';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  userName: string;
  onChanged?: () => void;
}

const GRANTABLE = [
  { role: 'vendor', label: 'Vendor', description: 'Access to vendor portal & business tools' },
  { role: 'rider', label: 'Rider', description: 'Access to rider portal & delivery tools' },
  { role: 'delivery_company', label: 'Delivery Company', description: 'Access to fleet operator portal' },
];

export function AdminManageRolesDialog({ open, onOpenChange, userId, userName, onChanged }: Props) {
  const { toast } = useToast();
  const { requireStepUp, stepUpDialog } = useAdminStepUp();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !userId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      setRoles((data || []).map(r => r.role as string));
      setLoading(false);
    })();
  }, [open, userId]);

  const run = async (role: string, action: 'grant' | 'revoke') => {
    if (!userId) return;
    setBusy(role + action);
    try {
      const stepUpToken = await requireStepUp({
        action: action === 'grant' ? 'role_grant' : 'role_revoke',
        targetType: 'user',
        targetId: userId,
        label: `${action === 'grant' ? 'Grant' : 'Remove'} ${role} role for ${userName}`,
      });
      const { data, error } = await supabase.functions.invoke('admin-manage-role', {
        body: { targetUserId: userId, role, action, stepUpToken },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: action === 'grant' ? 'Role granted' : 'Role removed', description: `${role} ${action === 'grant' ? 'added to' : 'removed from'} ${userName}.` });
      setRoles(prev => action === 'grant' ? Array.from(new Set([...prev, role])) : prev.filter(r => r !== role));
      onChanged?.();
    } catch (e: any) {
      if (e?.message === 'step_up_cancelled') { setBusy(null); return; }
      toast({ title: 'Failed', description: e?.message || 'Could not update role', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const isAdmin = roles.includes('admin');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {stepUpDialog}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Manage Roles</DialogTitle>
          <DialogDescription>
            Grant or remove portal access for <span className="font-medium">{userName}</span>. Changes apply immediately.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">Current:</span>
              {roles.length === 0 && <Badge variant="outline">customer</Badge>}
              {roles.map(r => <Badge key={r} variant={r === 'admin' ? 'destructive' : 'secondary'}>{r}</Badge>)}
            </div>

            {isAdmin && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Admin role cannot be granted or removed from this dialog. Admins are managed separately.</span>
              </div>
            )}

            <div className="space-y-2 pt-1">
              {GRANTABLE.map(({ role, label, description }) => {
                const has = roles.includes(role);
                const isBusy = busy === role + (has ? 'revoke' : 'grant');
                return (
                  <div key={role} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{description}</div>
                    </div>
                    {has ? (
                      <Button variant="outline" size="sm" disabled={isBusy} onClick={() => run(role, 'revoke')}>
                        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><X className="w-4 h-4 mr-1" /> Remove</>}
                      </Button>
                    ) : (
                      <Button size="sm" disabled={isBusy} onClick={() => run(role, 'grant')}>
                        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Grant</>}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
