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
import { UserPlus, Shield, Users, Loader2, Trash2, Link, Copy, Check, Mail } from 'lucide-react';
import { format } from 'date-fns';
import type { VendorStaffRole } from '@/hooks/useVendorPermissions';

const generateInviteCode = () => {
  return 'vs_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
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
  const [inviteRole, setInviteRole] = useState<VendorStaffRole>('viewer');
  const [inviting, setInviting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, [vendorId]);

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('vendor_staff')
        .select('id, vendor_id, user_id, role, is_active, invite_email, invite_accepted_at, created_at')
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

  const handleInviteStaff = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: 'Please enter an email', variant: 'destructive' });
      return;
    }

    setInviting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const inviteCode = generateInviteCode();
      const placeholderUserId = crypto.randomUUID();
      
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
      
      const { error } = await supabase
        .from('vendor_staff')
        .insert({
          vendor_id: vendorId,
          user_id: placeholderUserId,
          role: inviteRole,
          invite_email: inviteEmail,
          invite_code: inviteCode,
          invited_by: user?.id,
          is_active: false
        } as any);

      if (error) throw error;

      const inviteLink = `${window.location.origin}/vendor/staff/join/${inviteCode}`;
      setGeneratedLink(inviteLink);
      
      // Send invite email
      try {
        const { error: emailError } = await supabase.functions.invoke('send-staff-invite-email', {
          body: {
            email: inviteEmail,
            inviteUrl: inviteLink,
            inviterName: inviterProfile?.full_name || 'A team member',
            role: inviteRole,
            platform: 'vendor',
            vendorName: vendor?.name
          }
        });
        
        if (emailError) {
          console.error('Error sending invite email:', emailError);
          toast({ 
            title: 'Invite created!', 
            description: 'Email could not be sent. Please share the link manually.',
          });
        } else {
          toast({ 
            title: 'Invite sent!', 
            description: `Email sent to ${inviteEmail}`,
          });
        }
      } catch (emailErr) {
        console.error('Error sending invite email:', emailErr);
        toast({ title: 'Invite created! Share the link manually.' });
      }
      
      fetchStaff();
    } catch (error: any) {
      console.error('Error inviting staff:', error);
      toast({ 
        title: 'Error creating invite', 
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
    setInviteRole('viewer');
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
              <DialogTitle>Invite New Staff Member</DialogTitle>
            </DialogHeader>
            
            {generatedLink ? (
              <div className="space-y-4 pt-4">
                <div className="p-4 rounded-lg bg-secondary">
                  <p className="text-sm text-muted-foreground mb-2">Share this link with your staff member:</p>
                  <div className="flex gap-2">
                    <Input value={generatedLink} readOnly className="flex-1 text-xs" />
                    <Button size="icon" variant="outline" onClick={copyToClipboard}>
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  The staff member will use this link to create their account and join your team.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={handleCloseInviteDialog}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Staff Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="staff@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as VendorStaffRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager">Manager - Full access except withdrawals</SelectItem>
                      <SelectItem value="cashier">Cashier - Process orders only</SelectItem>
                      <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleInviteStaff} disabled={inviting} className="w-full">
                  {inviting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link className="w-4 h-4 mr-2" />}
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
                            <Link className="w-3 h-3" /> Pending invite
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
                    <TableCell className="text-right">
                      {member.role !== 'owner' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveStaff(member.id)}
                        >
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
