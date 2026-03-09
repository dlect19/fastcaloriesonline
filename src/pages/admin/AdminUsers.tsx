import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Search, Loader2, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function AdminUsers() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  // Email change dialog
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newEmail, setNewEmail] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
      return;
    }

    await fetchUsers();
  };

  const fetchUsers = async () => {
    try {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role');

      const usersWithRoles = profilesData?.map(profile => ({
        ...profile,
        roles: rolesData?.filter(r => r.user_id === profile.user_id).map(r => r.role) || []
      })) || [];

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!selectedUser || !newEmail.trim()) {
      toast({ title: 'Missing info', description: 'Enter a new email address', variant: 'destructive' });
      return;
    }

    setChangingEmail(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('admin-update-user-email', {
        body: { userId: selectedUser.user_id, newEmail: newEmail.trim() },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast({
        title: 'Email Updated',
        description: `Login email for ${selectedUser.full_name || 'user'} changed to ${newEmail.trim()}`,
      });

      setEmailDialogOpen(false);
      setNewEmail('');
      setSelectedUser(null);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to update email', variant: 'destructive' });
    } finally {
      setChangingEmail(false);
    }
  };

  const filteredUsers = users.filter(user =>
    user.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    user.phone?.includes(search)
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Users</h1>
          <p className="text-muted-foreground">View all platform users</p>
        </div>

        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Users ({filteredUsers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Name</th>
                    <th className="text-left py-3 px-4 font-medium">Phone</th>
                    <th className="text-left py-3 px-4 font-medium">Roles</th>
                    <th className="text-left py-3 px-4 font-medium">Joined</th>
                    <th className="text-left py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b hover:bg-secondary/50">
                      <td className="py-3 px-4">{user.full_name || 'N/A'}</td>
                      <td className="py-3 px-4">{user.phone || 'N/A'}</td>
                      <td className="py-3 px-4">
                        {user.roles?.join(', ') || 'customer'}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {format(new Date(user.created_at), 'PP')}
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedUser(user);
                            setNewEmail('');
                            setEmailDialogOpen(true);
                          }}
                        >
                          <Mail className="w-4 h-4 text-primary mr-1" />
                          Change Email
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Change Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              Change Login Email
            </DialogTitle>
            <DialogDescription>
              Update the login email for <strong>{selectedUser?.full_name || 'this user'}</strong>. The new email will be auto-confirmed.
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
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleChangeEmail}
              disabled={changingEmail || !newEmail.trim()}
            >
              {changingEmail ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating...</>
              ) : (
                'Update Email'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
