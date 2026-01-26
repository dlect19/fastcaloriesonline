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
import { UserPlus, Shield, Users, Loader2, Trash2, Link, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import type { AdminStaffRole } from '@/hooks/useAdminPermissions';

const generateInviteCode = () => {
  return 'as_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
};

interface AdminStaffMember {
  id: string;
  user_id: string;
  role: AdminStaffRole;
  is_active: boolean;
  invite_email: string | null;
  invite_code: string | null;
  invite_accepted_at: string | null;
  created_at: string;
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
  const [newRole, setNewRole] = useState<AdminStaffRole>('support');
  const [adding, setAdding] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_staff')
        .select('id, user_id, role, is_active, invite_email, invite_accepted_at, created_at')
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

  const handleAddStaff = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: 'Please enter an email', variant: 'destructive' });
      return;
    }

    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const inviteCode = generateInviteCode();
      const placeholderUserId = crypto.randomUUID();

      const { error } = await supabase
        .from('admin_staff')
        .insert({
          user_id: placeholderUserId,
          role: newRole,
          invite_email: inviteEmail,
          invite_code: inviteCode,
          invited_by: user?.id,
          is_active: false
        } as any);

      if (error) throw error;

      const inviteLink = `${window.location.origin}/admin/staff/join/${inviteCode}`;
      setGeneratedLink(inviteLink);
      
      toast({ title: 'Admin invite created!' });
      fetchStaff();
    } catch (error: any) {
      console.error('Error adding admin staff:', error);
      toast({ 
        title: 'Error creating invite', 
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
    setNewRole('support');
    setGeneratedLink(null);
    setCopied(false);
  };

  const copyToClipboard = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast({ title: 'Link copied!' });
      setTimeout(() => setCopied(false), 2000);
    }
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
            
            {generatedLink ? (
              <div className="space-y-4 pt-4">
                <div className="p-4 rounded-lg bg-secondary">
                  <p className="text-sm text-muted-foreground mb-2">Share this link with the new admin:</p>
                  <div className="flex gap-2">
                    <Input value={generatedLink} readOnly className="flex-1 text-xs" />
                    <Button size="icon" variant="outline" onClick={copyToClipboard}>
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  The admin will use this link to create their account and join the admin team.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={handleCloseDialog}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Admin Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
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
                  {adding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link className="w-4 h-4 mr-2" />}
                  Generate Invite Link
                </Button>
              </div>
            )}
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
              <Badge className={ROLE_COLORS.super_admin}>Super Admin</Badge>
              <p className="text-xs text-muted-foreground mt-2">Full platform access, manage other admins, process withdrawals</p>
            </div>
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.admin}>Admin</Badge>
              <p className="text-xs text-muted-foreground mt-2">Manage vendors, riders, orders, promos (no withdrawals)</p>
            </div>
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.support}>Support</Badge>
              <p className="text-xs text-muted-foreground mt-2">View reports and handle customer support tickets</p>
            </div>
            <div className="p-3 rounded-lg border">
              <Badge className={ROLE_COLORS.analyst}>Analyst</Badge>
              <p className="text-xs text-muted-foreground mt-2">View-only access to dashboard and reports</p>
            </div>
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
                            <Link className="w-3 h-3" /> Pending invite
                          </p>
                        )}
                      </div>
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
