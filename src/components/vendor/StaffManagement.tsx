import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { UserPlus, Shield, Users, Loader2, Trash2, Eye, EyeOff, KeyRound, Clock, Link2, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import type { VendorStaffRole, VendorPermission } from '@/hooks/useVendorPermissions';
import { PermissionChecklistDialog } from '@/components/shared/PermissionChecklistDialog';

const VENDOR_PERMISSION_DEFS: { key: string; label: string; description: string }[] = [
  { key: 'view_dashboard', label: 'View Dashboard', description: 'Access the vendor dashboard' },
  { key: 'manage_menu', label: 'Manage Menu', description: 'Add, edit, and remove menu items' },
  { key: 'process_orders', label: 'Process Orders', description: 'View and manage customer orders' },
  { key: 'view_earnings', label: 'View Earnings', description: 'See revenue and financial reports' },
  { key: 'request_withdrawal', label: 'Request Withdrawal', description: 'Withdraw funds to bank account' },
  { key: 'manage_staff', label: 'Manage Staff', description: 'Invite and manage team members' },
  { key: 'edit_settings', label: 'Edit Settings', description: 'Change vendor settings and profile' },
  { key: 'manage_promos', label: 'Manage Promos', description: 'Create and manage promotions' },
  { key: 'manage_riders', label: 'Manage Riders', description: 'Manage affiliated riders' },
];

const VENDOR_ROLE_PERMISSIONS: Record<VendorStaffRole, string[]> = {
  owner: ['view_dashboard', 'manage_menu', 'process_orders', 'view_earnings', 'request_withdrawal', 'manage_staff', 'edit_settings', 'manage_promos', 'manage_riders'],
  manager: ['view_dashboard', 'manage_menu', 'process_orders', 'view_earnings', 'manage_promos', 'manage_riders'],
  cashier: ['view_dashboard', 'process_orders'],
  viewer: ['view_dashboard'],
};

interface StaffMember {
  id: string;
  user_id: string;
  role: VendorStaffRole;
  is_active: boolean;
  invite_email: string | null;
  invite_code: string | null;
  invite_accepted_at: string | null;
  created_at: string;
  permissions?: string[];
  profile?: {
    full_name: string | null;
    phone: string | null;
  };
}

const ROLE_LABELS: Record<VendorStaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  viewer: 'Viewer'
};

const ROLE_COLORS: Record<VendorStaffRole, string> = {
  owner: 'bg-primary text-primary-foreground',
  manager: 'bg-blue-500 text-white',
  cashier: 'bg-green-500 text-white',
  viewer: 'bg-muted text-muted-foreground'
};

interface StaffManagementProps {
  vendorId: string;
}

export function StaffManagement({ vendorId }: StaffManagementProps) {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<VendorStaffRole>('viewer');
  const [inviting, setInviting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [vendorSlug, setVendorSlug] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [invitePermissions, setInvitePermissions] = useState<string[]>([]);
  const [invitePermDialogOpen, setInvitePermDialogOpen] = useState(false);

  useEffect(() => {
    fetchStaff();
    fetchVendorSlug();
  }, [vendorId]);

  const fetchVendorSlug = async () => {
    const { data } = await supabase
      .from('vendors')
      .select('slug')
      .eq('id', vendorId)
      .single();
    if (data?.slug) setVendorSlug(data.slug);
  };

  const workspaceUrl = vendorSlug
    ? `${window.location.origin}/workspace/${vendorSlug}`
    : null;

  const copyWorkspaceLink = async () => {
    if (!workspaceUrl) return;
    await navigator.clipboard.writeText(workspaceUrl);
    setLinkCopied(true);
    toast({ title: 'Link copied!' });
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('vendor_staff')
        .select('id, vendor_id, user_id, role, is_active, invite_email, invite_accepted_at, created_at, permissions')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const staffWithProfiles = await Promise.all(
        (data || []).map(async (member: any) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('user_id', member.user_id)
            .maybeSingle();
          
          return { ...member, profile } as StaffMember;
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
    if (!inviteEmail.trim()) {
      toast({ title: 'Please enter an email', variant: 'destructive' });
      return;
    }
    if (!inviteFullName.trim()) {
      toast({ title: 'Please enter the staff name', variant: 'destructive' });
      return;
    }
    if (!invitePassword || invitePassword.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setInviting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get vendor name for the email
      const { data: vendor } = await supabase
        .from('vendors')
        .select('name')
        .eq('id', vendorId)
        .single();
      
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
          role: inviteRole,
          platform: 'vendor',
          vendorId: vendorId,
          vendorName: vendor?.name,
          inviterName: inviterProfile?.full_name,
          inviterId: user?.id
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // If custom permissions were set, save them to the new staff record
      if (invitePermissions.length > 0 && data.userId) {
        await supabase
          .from('vendor_staff')
          .update({ permissions: invitePermissions })
          .eq('vendor_id', vendorId)
          .eq('user_id', data.userId);
      }

      toast({ 
        title: 'Staff account created!', 
        description: `Credentials sent to ${inviteEmail}`,
      });
      
      handleCloseInviteDialog();
      fetchStaff();
    } catch (error: any) {
      console.error('Error creating staff:', error);
      toast({ 
        title: 'Error creating staff account', 
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setInviting(false);
    }
  };

  const handleCloseInviteDialog = () => {
    setInviteOpen(false);
    setInviteEmail('');
    setInvitePassword('');
    setInviteFullName('');
    setInviteRole('viewer');
    setInvitePermissions([]);
  };

  const handleToggleActive = async (staffId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('vendor_staff')
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

  const handleUpdateRole = async (staffId: string, newRole: VendorStaffRole) => {
    try {
      const { error } = await supabase
        .from('vendor_staff')
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
    if (!confirm('Are you sure you want to remove this staff member?')) return;

    try {
      const { error } = await supabase
        .from('vendor_staff')
        .delete()
        .eq('id', staffId);

      if (error) throw error;

      setStaff(prev => prev.filter(s => s.id !== staffId));
      toast({ title: 'Staff member removed' });
    } catch (error) {
      console.error('Error removing staff:', error);
      toast({ title: 'Error removing staff', variant: 'destructive' });
    }
  };

  const handleSavePermissions = async (permissions: string[]) => {
    if (!editingStaff) return;
    try {
      const { error } = await supabase
        .from('vendor_staff')
        .update({ permissions })
        .eq('id', editingStaff.id);

      if (error) throw error;

      setStaff(prev => prev.map(s => 
        s.id === editingStaff.id ? { ...s, permissions } : s
      ));
      
      toast({ title: permissions.length > 0 ? 'Custom permissions saved' : 'Reset to role defaults' });
    } catch (error) {
      console.error('Error saving permissions:', error);
      toast({ title: 'Error saving permissions', variant: 'destructive' });
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
      {/* Workspace Login Link */}
      {workspaceUrl && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Link2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm mb-1">Staff Login Link</h3>
                <p className="text-xs text-muted-foreground mb-2">Share this link with your staff so they can log in to your workspace</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-background border rounded px-2 py-1.5 truncate flex-1 block">
                    {workspaceUrl}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyWorkspaceLink} className="shrink-0">
                    {linkCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {linkCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Staff Management
          </h2>
          <p className="text-muted-foreground">Manage your team and their permissions</p>
        </div>
        
        <Dialog open={inviteOpen} onOpenChange={(open) => !open && handleCloseInviteDialog()}>
          <DialogTrigger asChild>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Staff Member</DialogTitle>
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
                  placeholder="staff@example.com"
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
                <p className="text-xs text-muted-foreground">Password will be sent to the staff via email</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as VendorStaffRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner - Full access including withdrawals & staff</SelectItem>
                    <SelectItem value="manager">Manager - Full access except withdrawals</SelectItem>
                    <SelectItem value="cashier">Cashier - Process orders only</SelectItem>
                    <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tab Permissions</Label>
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div>
                    <p className="text-sm font-medium">
                      {invitePermissions.length > 0 
                        ? `${invitePermissions.length} custom permission${invitePermissions.length > 1 ? 's' : ''}` 
                        : `Using ${inviteRole} role defaults`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invitePermissions.length > 0 
                        ? 'Custom permissions override role defaults' 
                        : 'Click to customize which tabs this staff can access'}
                    </p>
                  </div>
                  <Button 
                    type="button" 
                    variant={invitePermissions.length > 0 ? "secondary" : "outline"} 
                    size="sm"
                    onClick={() => setInvitePermDialogOpen(true)}
                  >
                    <Shield className="w-4 h-4 mr-1" />
                    {invitePermissions.length > 0 ? 'Edit' : 'Customize'}
                  </Button>
                </div>
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
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Role Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.owner}>Owner</Badge>
              <p className="text-xs text-muted-foreground mt-2">Full access including withdrawals and staff management</p>
            </div>
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.manager}>Manager</Badge>
              <p className="text-xs text-muted-foreground mt-2">Menu, orders, earnings, promos, riders (no withdrawals)</p>
            </div>
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.cashier}>Cashier</Badge>
              <p className="text-xs text-muted-foreground mt-2">Process orders and view dashboard only</p>
            </div>
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.viewer}>Viewer</Badge>
              <p className="text-xs text-muted-foreground mt-2">Read-only access to dashboard</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team Members ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No staff members yet</p>
              <p className="text-sm">Invite team members to help manage your business</p>
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
                      {member.role === 'owner' ? (
                        <Badge className={ROLE_COLORS[member.role]}>{ROLE_LABELS[member.role]}</Badge>
                      ) : (
                        <Select 
                          value={member.role} 
                          onValueChange={(v) => handleUpdateRole(member.id, v as VendorStaffRole)}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="cashier">Cashier</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {member.role !== 'owner' ? (
                        <Switch
                          checked={member.is_active}
                          onCheckedChange={(checked) => handleToggleActive(member.id, checked)}
                        />
                      ) : (
                        <Badge variant="outline">Always Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.invite_accepted_at 
                        ? format(new Date(member.invite_accepted_at), 'PP')
                        : 'Not yet'}
                    </TableCell>
                    <TableCell className="text-right flex items-center justify-end gap-1">
                      {member.role !== 'owner' && (
                        <>
                          <Button
                            variant={member.permissions && member.permissions.length > 0 ? "secondary" : "ghost"}
                            size="sm"
                            title="Edit permissions"
                            onClick={() => {
                              setEditingStaff(member);
                              setPermDialogOpen(true);
                            }}
                            className="gap-1"
                          >
                            <Shield className="w-4 h-4" />
                            {member.permissions && member.permissions.length > 0 
                              ? <span className="text-xs">Custom</span>
                              : <span className="text-xs hidden sm:inline">Permissions</span>}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveStaff(member.id)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editingStaff && (
        <PermissionChecklistDialog
          open={permDialogOpen}
          onOpenChange={setPermDialogOpen}
          allPermissions={VENDOR_PERMISSION_DEFS}
          roleDefaults={VENDOR_ROLE_PERMISSIONS[editingStaff.role]}
          currentPermissions={editingStaff.permissions || []}
          onSave={handleSavePermissions}
          roleName={editingStaff.role.charAt(0).toUpperCase() + editingStaff.role.slice(1)}
        />
      )}

      <PermissionChecklistDialog
        open={invitePermDialogOpen}
        onOpenChange={setInvitePermDialogOpen}
        allPermissions={VENDOR_PERMISSION_DEFS}
        roleDefaults={VENDOR_ROLE_PERMISSIONS[inviteRole]}
        currentPermissions={invitePermissions}
        onSave={setInvitePermissions}
        roleName={inviteRole.charAt(0).toUpperCase() + inviteRole.slice(1)}
      />
    </div>
  );
}
