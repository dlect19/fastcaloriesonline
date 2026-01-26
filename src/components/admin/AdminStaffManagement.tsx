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
import { UserPlus, Shield, Users, Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { AdminStaffRole } from '@/hooks/useAdminPermissions';

interface AdminStaffMember {
  id: string;
  user_id: string;
  role: AdminStaffRole;
  is_active: boolean;
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
  super_admin: 'bg-red-500 text-white',
  admin: 'bg-primary text-primary-foreground',
  support: 'bg-blue-500 text-white',
  analyst: 'bg-muted text-muted-foreground'
};

export function AdminStaffManagement() {
  const { toast } = useToast();
  const [staff, setStaff] = useState<AdminStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<AdminStaffRole>('support');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_staff')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch profile info for each staff member
      const staffWithProfiles = await Promise.all(
        (data || []).map(async (member) => {
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
    if (!newUserId.trim()) {
      toast({ title: 'Please enter a user ID', variant: 'destructive' });
      return;
    }

    setAdding(true);
    try {
      // First, add admin role to user_roles
      await supabase
        .from('user_roles')
        .upsert({ user_id: newUserId, role: 'admin' }, { onConflict: 'user_id,role' });

      // Then add to admin_staff
      const { error } = await supabase
        .from('admin_staff')
        .insert({
          user_id: newUserId,
          role: newRole,
          is_active: true
        });

      if (error) throw error;

      toast({ title: 'Admin staff added!' });
      setAddOpen(false);
      setNewUserId('');
      setNewRole('support');
      fetchStaff();
    } catch (error: any) {
      console.error('Error adding admin staff:', error);
      toast({ 
        title: 'Error adding staff', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setAdding(false);
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" />
            Admin Staff Management
          </h2>
          <p className="text-muted-foreground">Manage platform administrators and their permissions</p>
        </div>
        
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
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
                <Label htmlFor="userId">User ID</Label>
                <Input
                  id="userId"
                  placeholder="Enter user's UUID"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Find the user's ID from the Users page
                </p>
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
                {adding && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Add Admin Staff
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Role Legend */}
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

      {/* Staff List */}
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
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {member.profile?.full_name || 'Unknown'}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {member.user_id.slice(0, 8)}...
                        </p>
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
                      {format(new Date(member.created_at), 'PP')}
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
