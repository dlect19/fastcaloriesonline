import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { UserPlus, Shield, Users, Loader2, Trash2, Eye, EyeOff, KeyRound, Clock } from 'lucide-react';
import { format } from 'date-fns';
import type { DeliveryStaffRole } from '@/hooks/useDeliveryPermissions';

interface StaffMember {
  id: string;
  user_id: string;
  role: DeliveryStaffRole;
  is_active: boolean;
  invite_email: string | null;
  invite_accepted_at: string | null;
  created_at: string;
  profile?: { full_name: string | null; phone: string | null };
}

const ROLE_LABELS: Record<DeliveryStaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  dispatcher: 'Dispatcher',
  viewer: 'Viewer'
};

const ROLE_COLORS: Record<DeliveryStaffRole, string> = {
  owner: 'bg-primary text-primary-foreground',
  manager: 'bg-blue-500 text-white',
  dispatcher: 'bg-green-500 text-white',
  viewer: 'bg-muted text-muted-foreground'
};

interface DeliveryStaffManagementProps {
  companyId: string;
}

export function DeliveryStaffManagement({ companyId }: DeliveryStaffManagementProps) {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<DeliveryStaffRole>('dispatcher');
  const [inviting, setInviting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, [companyId]);

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('delivery_company_staff')
        .select('id, delivery_company_id, user_id, role, is_active, created_at')
        .eq('delivery_company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const staffWithProfiles = await Promise.all(
        (data || []).map(async (member: any) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('user_id', member.user_id)
            .maybeSingle();
          return { ...member, profile, invite_email: null, invite_accepted_at: null } as StaffMember;
        })
      );

      setStaff(staffWithProfiles);
    } catch (error) {
      console.error('Error fetching staff:', error);
      toast({ title: 'Error loading staff', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setInvitePassword(password);
  };

  const handleCreateStaff = async () => {
    if (!inviteEmail.trim() || !inviteFullName.trim()) {
      toast({ title: 'Please fill all fields', variant: 'destructive' });
      return;
    }
    if (!invitePassword || invitePassword.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setInviting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: company } = await supabase
        .from('delivery_companies')
        .select('name')
        .eq('id', companyId)
        .single();
      const { data: inviterProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user?.id)
        .single();

      const { data, error } = await supabase.functions.invoke('create-staff-account', {
        body: {
          email: inviteEmail,
          password: invitePassword,
          fullName: inviteFullName,
          role: inviteRole,
          platform: 'delivery',
          deliveryCompanyId: companyId,
          vendorName: company?.name,
          inviterName: inviterProfile?.full_name,
          inviterId: user?.id
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast({ title: 'Staff account created!', description: `Credentials sent to ${inviteEmail}` });
      handleCloseInviteDialog();
      fetchStaff();
    } catch (error: any) {
      console.error('Error creating staff:', error);
      toast({ title: 'Error creating staff account', description: error.message, variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  };

  const handleCloseInviteDialog = () => {
    setInviteOpen(false);
    setInviteEmail('');
    setInvitePassword('');
    setInviteFullName('');
    setInviteRole('dispatcher');
  };

  const handleToggleActive = async (staffId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('delivery_company_staff')
        .update({ is_active: isActive })
        .eq('id', staffId);
      if (error) throw error;
      setStaff(prev => prev.map(s => s.id === staffId ? { ...s, is_active: isActive } : s));
      toast({ title: isActive ? 'Staff activated' : 'Staff deactivated' });
    } catch (error) {
      toast({ title: 'Error updating staff', variant: 'destructive' });
    }
  };

  const handleUpdateRole = async (staffId: string, newRole: DeliveryStaffRole) => {
    try {
      const { error } = await supabase
        .from('delivery_company_staff')
        .update({ role: newRole as any })
        .eq('id', staffId);
      if (error) throw error;
      setStaff(prev => prev.map(s => s.id === staffId ? { ...s, role: newRole } : s));
      toast({ title: 'Role updated' });
    } catch (error) {
      toast({ title: 'Error updating role', variant: 'destructive' });
    }
  };

  const handleRemoveStaff = async (staffId: string) => {
    if (!confirm('Remove this staff member?')) return;
    try {
      const { error } = await supabase.from('delivery_company_staff').delete().eq('id', staffId);
      if (error) throw error;
      setStaff(prev => prev.filter(s => s.id !== staffId));
      toast({ title: 'Staff removed' });
    } catch (error) {
      toast({ title: 'Error removing staff', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" /> Staff Management
          </h2>
          <p className="text-muted-foreground">Manage your logistics team</p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={(open) => !open && handleCloseInviteDialog()}>
          <DialogTrigger asChild>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" /> Add Staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Staff Member</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input placeholder="John Doe" value={inviteFullName} onChange={(e) => setInviteFullName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input type="email" placeholder="staff@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input type={showPassword ? "text" : "password"} placeholder="Min. 6 characters" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <Button type="button" variant="outline" onClick={generatePassword}><KeyRound className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as DeliveryStaffRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner - Full access</SelectItem>
                    <SelectItem value="manager">Manager - Manage riders & view earnings</SelectItem>
                    <SelectItem value="dispatcher">Dispatcher - View deliveries</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreateStaff} disabled={inviting} className="w-full">
                {inviting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Create Account & Send Credentials
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Shield className="w-5 h-5" /> Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(Object.keys(ROLE_LABELS) as DeliveryStaffRole[]).map(role => (
              <div key={role} className="p-3 rounded-lg border">
                <Badge className={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Badge>
                <p className="text-xs text-muted-foreground mt-2">
                  {role === 'owner' && 'Full access including withdrawals and staff'}
                  {role === 'manager' && 'Manage riders, view deliveries and earnings'}
                  {role === 'dispatcher' && 'View dashboard and deliveries only'}
                  {role === 'viewer' && 'Read-only dashboard access'}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Team ({staff.length})</CardTitle></CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No staff members yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <p className="font-medium">{member.profile?.full_name || member.invite_email || 'Pending'}</p>
                    </TableCell>
                    <TableCell>
                      {member.role === 'owner' ? (
                        <Badge className={ROLE_COLORS.owner}>Owner</Badge>
                      ) : (
                        <Select value={member.role} onValueChange={(v) => handleUpdateRole(member.id, v as DeliveryStaffRole)}>
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="dispatcher">Dispatcher</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {member.role !== 'owner' ? (
                        <Switch checked={member.is_active} onCheckedChange={(c) => handleToggleActive(member.id, c)} />
                      ) : (
                        <Badge variant="outline">Always Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(member.created_at), 'PP')}
                    </TableCell>
                    <TableCell className="text-right">
                      {member.role !== 'owner' && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveStaff(member.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
