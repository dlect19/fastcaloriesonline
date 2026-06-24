import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { UserPlus, Shield, Users, Loader2, Trash2, Eye, EyeOff, KeyRound, Clock, Link2, Copy, Check, Save } from 'lucide-react';
import { format } from 'date-fns';
import type { AdminStaffRole, AdminPermission } from '@/hooks/useAdminPermissions';

// Map each sidebar tab to its required permission (keep in sync with AdminSidebar)
const SIDEBAR_TABS: { label: string; permission: AdminPermission }[] = [
  { label: 'Dashboard', permission: 'view_dashboard' },
  { label: 'Orders', permission: 'manage_vendors' },
  { label: 'Assisted Orders', permission: 'manage_assisted_orders' },
  { label: 'Shadow Credits', permission: 'manage_assisted_orders' },
  { label: 'POS Sales', permission: 'view_reports' },
  { label: 'Vendors', permission: 'manage_vendors' },
  { label: 'Riders', permission: 'manage_riders' },
  { label: 'Vendor Menus', permission: 'manage_vendors' },
  { label: 'Cuisine Categories', permission: 'manage_vendors' },
  { label: 'Reviews', permission: 'manage_vendors' },
  { label: 'Events', permission: 'manage_vendors' },
  { label: 'Events Analytics', permission: 'manage_vendors' },
  { label: 'Verify Tickets', permission: 'manage_vendors' },
  { label: 'Delivery Companies', permission: 'manage_vendors' },
  { label: 'Customers', permission: 'manage_users' },
  { label: 'Payouts', permission: 'process_withdrawals' },
  { label: 'On-Hold Payments', permission: 'process_withdrawals' },
  { label: 'Customer Wallets', permission: 'manage_users' },
  { label: 'Wallet Funding', permission: 'manage_users' },
  { label: 'Chargebacks', permission: 'process_withdrawals' },
  { label: 'Refund Audit', permission: 'process_withdrawals' },
  { label: 'Disputes', permission: 'process_withdrawals' },
  { label: 'Nutrition', permission: 'view_reports' },
  { label: 'Promo Codes', permission: 'manage_promos' },
  { label: 'Commission Promos', permission: 'manage_promos' },
  { label: 'Rewards & Spins', permission: 'manage_promos' },
  { label: 'Free Meals', permission: 'manage_promos' },
  { label: 'Carousel', permission: 'manage_vendors' },
  { label: 'Campaigns', permission: 'manage_vendors' },
  { label: 'Ad Placements', permission: 'manage_vendors' },
  { label: 'Users', permission: 'manage_users' },
  { label: 'Admin Staff', permission: 'manage_admin_staff' },
  { label: 'Payroll', permission: 'manage_admin_staff' },
  { label: 'Referrals', permission: 'manage_promos' },
  { label: 'Expenses', permission: 'process_withdrawals' },
  { label: 'Legal', permission: 'platform_settings' },
  { label: 'FAQ', permission: 'platform_settings' },
  { label: 'Support', permission: 'handle_support' },
  { label: 'WhatsApp', permission: 'platform_settings' },
  { label: 'Notifications', permission: 'platform_settings' },
  { label: 'Coverage Areas', permission: 'platform_settings' },
  { label: 'Financial Tools', permission: 'process_withdrawals' },
  { label: 'Ambassadors', permission: 'manage_promos' },
  { label: 'Drug Database', permission: 'manage_vendors' },
  { label: 'Pharmacy Analytics', permission: 'view_reports' },
  { label: 'Settings', permission: 'platform_settings' },
];

// Unique permissions list shown when editing a role
const ALL_PERMISSIONS: { key: AdminPermission; label: string }[] = [
  { key: 'view_dashboard', label: 'View Dashboard' },
  { key: 'manage_vendors', label: 'Manage Vendors / Orders / Menus / Reviews / Events / Carousel' },
  { key: 'approve_vendors', label: 'Approve Vendors' },
  { key: 'manage_riders', label: 'Manage Riders' },
  { key: 'manage_assisted_orders', label: 'Manage Assisted Orders & Shadow Credits' },
  { key: 'process_withdrawals', label: 'Process Withdrawals / Disputes / Chargebacks / Expenses' },
  { key: 'manage_admin_staff', label: 'Manage Admin Staff & Payroll' },
  { key: 'platform_settings', label: 'Platform Settings / Legal / FAQ / Coverage' },
  { key: 'view_reports', label: 'View Reports (Nutrition, POS, Pharmacy)' },
  { key: 'handle_support', label: 'Handle Support' },
  { key: 'manage_promos', label: 'Manage Promos, Rewards, Referrals & Ambassadors' },
  { key: 'manage_users', label: 'Manage Users / Customers / Wallets' },
];

const DEFAULT_ROLE_PERMISSIONS: Record<string, AdminPermission[]> = {
  admin: [
    'view_dashboard', 'manage_vendors', 'approve_vendors', 'manage_riders',
    'manage_assisted_orders', 'view_reports', 'handle_support', 'manage_promos', 'manage_users'
  ],
  support: ['view_dashboard', 'view_reports', 'handle_support', 'manage_assisted_orders'],
  analyst: ['view_dashboard', 'view_reports']
};

const EDITABLE_ROLES: { key: string; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'support', label: 'Support' },
  { key: 'analyst', label: 'Analyst' },
];


interface AdminStaffMember {
  id: string;
  user_id: string;
  role: AdminStaffRole;
  is_active: boolean;
  invite_email: string | null;
  invite_code: string | null;
  invite_accepted_at: string | null;
  created_at: string;
  last_activity_at?: string | null;
  profile?: {
    full_name: string | null;
    phone: string | null;
  };
}

const ROLE_LABELS: Record<AdminStaffRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  support: 'Support',
  analyst: 'Analyst'
};

const ROLE_COLORS: Record<AdminStaffRole, string> = {
  super_admin: 'bg-destructive text-destructive-foreground',
  admin: 'bg-primary text-primary-foreground',
  support: 'bg-blue-500 text-white',
  analyst: 'bg-muted text-muted-foreground'
};

export function AdminStaffManagement() {
  const { toast } = useToast();
  const [staff, setStaff] = useState<AdminStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [newRole, setNewRole] = useState<AdminStaffRole>('support');
  const [adding, setAdding] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<Record<string, AdminPermission[]>>({ ...DEFAULT_ROLE_PERMISSIONS });
  const [savingPerms, setSavingPerms] = useState(false);

  const adminLoginUrl = `${window.location.origin}/admin/auth`;

  const copyLoginLink = async () => {
    await navigator.clipboard.writeText(adminLoginUrl);
    setLinkCopied(true);
    toast({ title: 'Link copied!' });
    setTimeout(() => setLinkCopied(false), 2000);
  };

  useEffect(() => {
    fetchStaff();
    fetchRolePermissions();
  }, []);

  const fetchRolePermissions = async () => {
    const { data } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'admin_role_permissions')
      .maybeSingle();
    if (data?.value) {
      try {
        const parsed = JSON.parse(data.value);
        setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...parsed });
      } catch { /* use defaults */ }
    }
  };

  const togglePermission = (role: string, permission: AdminPermission) => {
    setRolePermissions(prev => {
      const current = prev[role] || [];
      const updated = current.includes(permission)
        ? current.filter(p => p !== permission)
        : [...current, permission];
      return { ...prev, [role]: updated };
    });
  };

  const saveRolePermissions = async () => {
    setSavingPerms(true);
    try {
      const { error } = await supabase
        .from('platform_settings')
        .upsert({ 
          key: 'admin_role_permissions', 
          value: JSON.stringify(rolePermissions),
          description: 'Custom permission overrides for admin staff roles'
        }, { onConflict: 'key' });
      if (error) throw error;
      toast({ title: 'Role permissions saved!' });
    } catch (err: any) {
      toast({ title: 'Error saving permissions', description: err.message, variant: 'destructive' });
    } finally {
      setSavingPerms(false);
    }
  };

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_staff')
        .select('id, user_id, role, is_active, invite_email, invite_accepted_at, created_at, last_activity_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const staffWithProfiles = await Promise.all(
        (data || []).map(async (member: any) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('user_id', member.user_id)
            .maybeSingle();
          
          return { ...member, profile } as AdminStaffMember;
        })
      );

      setStaff(staffWithProfiles);
    } catch (error) {
      console.error('Error fetching admin staff:', error);
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

  const handleAddStaff = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: 'Please enter an email', variant: 'destructive' });
      return;
    }
    if (!inviteFullName.trim()) {
      toast({ title: 'Please enter the admin name', variant: 'destructive' });
      return;
    }
    if (!invitePassword || invitePassword.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get inviter's profile name
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
          role: newRole,
          platform: 'admin',
          inviterName: inviterProfile?.full_name,
          inviterId: user?.id
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast({ 
        title: 'Admin account created!', 
        description: `Credentials sent to ${inviteEmail}`,
      });
      
      handleCloseDialog();
      fetchStaff();
    } catch (error: any) {
      console.error('Error creating admin staff:', error);
      toast({ 
        title: 'Error creating admin account', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setAdding(false);
    }
  };

  const handleCloseDialog = () => {
    setAddOpen(false);
    setInviteEmail('');
    setInvitePassword('');
    setInviteFullName('');
    setNewRole('support');
  };

  const handleToggleActive = async (staffId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('admin_staff')
        .update({ is_active: isActive })
        .eq('id', staffId);

      if (error) throw error;

      setStaff(prev => prev.map(s => 
        s.id === staffId ? { ...s, is_active: isActive } : s
      ));
      
      toast({ title: isActive ? 'Staff activated' : 'Staff deactivated' });
    } catch (error) {
      console.error('Error updating staff:', error);
      toast({ title: 'Error updating staff', variant: 'destructive' });
    }
  };

  const handleUpdateRole = async (staffId: string, newRole: AdminStaffRole) => {
    try {
      const { error } = await supabase
        .from('admin_staff')
        .update({ role: newRole })
        .eq('id', staffId);

      if (error) throw error;

      setStaff(prev => prev.map(s => 
        s.id === staffId ? { ...s, role: newRole } : s
      ));
      
      toast({ title: 'Role updated successfully' });
    } catch (error) {
      console.error('Error updating role:', error);
      toast({ title: 'Error updating role', variant: 'destructive' });
    }
  };

  const handleRemoveStaff = async (staffId: string) => {
    if (!confirm('Are you sure you want to remove this admin?')) return;

    try {
      const { error } = await supabase
        .from('admin_staff')
        .delete()
        .eq('id', staffId);

      if (error) throw error;

      setStaff(prev => prev.filter(s => s.id !== staffId));
      toast({ title: 'Admin removed' });
    } catch (error) {
      console.error('Error removing admin:', error);
      toast({ title: 'Error removing admin', variant: 'destructive' });
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
      {/* Admin Login Link */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Link2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm mb-1">Admin Login Link</h3>
              <p className="text-xs text-muted-foreground mb-2">Share this link with your admin staff so they can log in to the admin portal</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background border rounded px-2 py-1.5 truncate flex-1 block">
                  {adminLoginUrl}
                </code>
                <Button size="sm" variant="outline" onClick={copyLoginLink} className="shrink-0">
                  {linkCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  {linkCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" />
            Admin Staff Management
          </h2>
          <p className="text-muted-foreground">Manage platform administrators and their permissions</p>
        </div>
        
        <Dialog open={addOpen} onOpenChange={(open) => !open && handleCloseDialog()}>
          <DialogTrigger asChild>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Add Admin
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Admin Staff</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="John Doe"
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Min. 6 characters"
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
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
                  <Button type="button" variant="outline" onClick={generatePassword} title="Generate password">
                    <KeyRound className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Password will be sent to the admin via email</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as AdminStaffRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin - Full platform access</SelectItem>
                    <SelectItem value="admin">Admin - Manage vendors, riders, orders</SelectItem>
                    <SelectItem value="support">Support - Handle customer issues</SelectItem>
                    <SelectItem value="analyst">Analyst - View reports only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddStaff} disabled={adding} className="w-full">
                {adding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Create Account & Send Credentials
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Role Permissions
            </CardTitle>
            <CardDescription className="mt-1">
              Configure which tabs each role can access. Super Admin always has full access.
            </CardDescription>
          </div>
          <Button onClick={saveRolePermissions} disabled={savingPerms} size="sm">
            {savingPerms ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Permission</TableHead>
                  {EDITABLE_ROLES.map(role => (
                    <TableHead key={role.key} className="text-center min-w-[100px]">
                      <Badge className={ROLE_COLORS[role.key as AdminStaffRole]}>{role.label}</Badge>
                    </TableHead>
                  ))}
                  <TableHead className="text-center min-w-[100px]">
                    <Badge className={ROLE_COLORS.super_admin}>Super Admin</Badge>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ALL_PERMISSIONS.map(perm => (
                  <TableRow key={perm.key}>
                    <TableCell className="font-medium text-sm">{perm.label}</TableCell>
                    {EDITABLE_ROLES.map(role => (
                      <TableCell key={role.key} className="text-center">
                        <Checkbox
                          checked={(rolePermissions[role.key] || []).includes(perm.key)}
                          onCheckedChange={() => togglePermission(role.key, perm.key)}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      <Checkbox checked disabled className="opacity-50" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Team ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No admin staff configured</p>
              <p className="text-sm">Add admin users to help manage the platform</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Presence</TableHead>
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
                      <div>
                        <p className="font-medium">
                          {member.profile?.full_name || member.invite_email || 'Pending'}
                        </p>
                        {!member.invite_accepted_at && member.invite_email && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Pending login
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const last = member.last_activity_at ? new Date(member.last_activity_at) : null;
                        const mins = last ? Math.floor((Date.now() - last.getTime()) / 60000) : null;
                        const online = mins !== null && mins < 15;
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                            <span className="text-xs text-muted-foreground">
                              {!last ? 'Never' : online ? 'Active now' : `${mins! < 60 ? mins + 'm' : Math.floor(mins!/60) + 'h'} ago`}
                            </span>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Select 
                        value={member.role} 
                        onValueChange={(v) => handleUpdateRole(member.id, v as AdminStaffRole)}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="support">Support</SelectItem>
                          <SelectItem value="analyst">Analyst</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={member.is_active}
                        onCheckedChange={(checked) => handleToggleActive(member.id, checked)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.invite_accepted_at 
                        ? format(new Date(member.invite_accepted_at), 'PP')
                        : 'Not yet'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveStaff(member.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
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
