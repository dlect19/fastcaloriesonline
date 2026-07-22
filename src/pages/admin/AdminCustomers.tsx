import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Search, Loader2, Users, ShoppingBag, Wallet, Plus, BadgeCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { format } from 'date-fns';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { usePagination } from '@/hooks/usePagination';
import { AdminDeleteUserButton } from '@/components/admin/AdminDeleteUserButton';
 
 interface Customer {
   id: string;
   user_id: string;
   full_name: string | null;
   phone: string | null;
   phone_verified: boolean;
   created_at: string;
   order_count: number;
   total_spent: number;
   wallet_balance: number;
   roles: string[];
 }
 
export default function AdminCustomers() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode, loading: envLoading } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  
  // Load wallet dialog
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [loadAmount, setLoadAmount] = useState('');
  const [loadReason, setLoadReason] = useState('');
  const [loadReference, setLoadReference] = useState('');
  const [loadingWallet, setLoadingWallet] = useState(false);
 
   useEffect(() => {
     if (!envLoading) {
       checkAuth();
     }
   }, [envLoading, isTestMode]);
 
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
 
     await fetchCustomers();
   };
 
   const fetchCustomers = async () => {
     try {
        setLoading(true);
       // Fetch users with customer role
       const { data: customerRoles } = await supabase
         .from('user_roles')
         .select('user_id')
         .eq('role', 'customer');
 
       const customerUserIds = customerRoles?.map(r => r.user_id) || [];
 
       if (customerUserIds.length === 0) {
         setCustomers([]);
         setLoading(false);
         return;
       }

       // Fetch ALL roles for these users
       const { data: allRoles } = await supabase
         .from('user_roles')
         .select('user_id, role')
         .in('user_id', customerUserIds);

       const rolesByUser: Record<string, string[]> = {};
       allRoles?.forEach(r => {
         if (!rolesByUser[r.user_id]) rolesByUser[r.user_id] = [];
         rolesByUser[r.user_id].push(r.role);
       });

       // Fetch profiles for these users
       const { data: profilesData } = await supabase
         .from('profiles')
         .select('*')
         .in('user_id', customerUserIds)
         .order('created_at', { ascending: false });
 
       // Fetch order stats
       const { data: orderStats } = await supabase
         .from('orders')
         .select('user_id, total')
         .in('user_id', customerUserIds)
         .eq('payment_status', 'paid');
 
       // Fetch wallet balances
       const { data: wallets } = await supabase
         .from('wallets')
         .select('user_id, balance, test_balance')
         .in('user_id', customerUserIds)
         .eq('wallet_type', 'customer');
 
       // Aggregate order stats by user
       const orderStatsByUser: Record<string, { count: number; total: number }> = {};
       orderStats?.forEach(order => {
         if (!order.user_id) return;
         if (!orderStatsByUser[order.user_id]) {
           orderStatsByUser[order.user_id] = { count: 0, total: 0 };
         }
         orderStatsByUser[order.user_id].count += 1;
         orderStatsByUser[order.user_id].total += Number(order.total) || 0;
       });
 
       // Map wallets by user
       const walletsByUser: Record<string, number> = {};
       wallets?.forEach(w => {
          walletsByUser[w.user_id] = isTestMode
            ? Number(w.test_balance) || 0
            : Number(w.balance) || 0;
       });
 
       // Merge all data
       const customersWithStats: Customer[] = profilesData?.map(profile => ({
         id: profile.id,
         user_id: profile.user_id,
         full_name: profile.full_name,
         phone: profile.phone,
         phone_verified: !!(profile as any).phone_verified,
         created_at: profile.created_at,
         order_count: orderStatsByUser[profile.user_id]?.count || 0,
         total_spent: orderStatsByUser[profile.user_id]?.total || 0,
         wallet_balance: walletsByUser[profile.user_id] || 0,
         roles: rolesByUser[profile.user_id] || ['customer'],
       })) || [];
 
       setCustomers(customersWithStats);
     } catch (error) {
       console.error('Error fetching customers:', error);
     } finally {
       setLoading(false);
     }
    };

    const handleLoadWallet = async () => {
      if (!selectedCustomer || !loadAmount || !loadReason) {
        toast({ title: 'Missing info', description: 'Enter amount and reason', variant: 'destructive' });
        return;
      }
      const amount = parseFloat(loadAmount);
      if (isNaN(amount) || amount <= 0) {
        toast({ title: 'Invalid Amount', description: 'Enter a valid positive amount', variant: 'destructive' });
        return;
      }

      setLoadingWallet(true);
      try {
        // Find or create wallet
        let { data: wallet } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', selectedCustomer.user_id)
          .eq('wallet_type', 'customer')
          .maybeSingle();

        if (!wallet) {
          const { data: newWallet, error: createErr } = await supabase
            .from('wallets')
            .insert({ user_id: selectedCustomer.user_id, wallet_type: 'customer' })
            .select('id')
            .single();
          if (createErr) throw createErr;
          wallet = newWallet;
        }

        const { error } = await supabase.rpc('admin_adjust_wallet_balance' as any, {
          p_wallet_id: wallet!.id,
          p_amount: amount,
          p_adjust_type: 'credit',
          p_notes: loadReason,
          p_environment: isTestMode ? 'development' : 'production',
          p_reference: loadReference || null,
        });

        if (error) throw error;

        toast({
          title: 'Wallet Loaded',
          description: `₦${amount.toLocaleString()} credited to ${selectedCustomer.full_name || 'customer'}'s wallet`,
        });

        // Update local state
        setCustomers(prev => prev.map(c =>
          c.user_id === selectedCustomer.user_id
            ? { ...c, wallet_balance: c.wallet_balance + amount }
            : c
        ));

        setLoadDialogOpen(false);
        setLoadAmount('');
        setLoadReason('');
        setLoadReference('');
        setSelectedCustomer(null);
      } catch (err: any) {
        toast({ title: 'Error', description: err.message || 'Failed to load wallet', variant: 'destructive' });
      } finally {
        setLoadingWallet(false);
      }
    };
  
    const filteredCustomers = customers.filter(customer =>
      customer.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      customer.phone?.includes(search)
    );
    const { paged: pagedCustomers, page: custPage, setPage: setCustPage, totalPages: custTotalPages } = usePagination(filteredCustomers, 10);
  
    const totalCustomers = customers.length;
    const totalRevenue = customers.reduce((sum, c) => sum + c.total_spent, 0);
    const avgOrderValue = totalRevenue / Math.max(customers.reduce((sum, c) => sum + c.order_count, 0), 1);
  
    if (loading) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      );
    }
  
    return (
    <AdminLayout>
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Customers</h1>
            <p className="text-muted-foreground">View all platform customers</p>
          </div>
  
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{totalCustomers.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">Total Customers</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <ShoppingBag className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">₦{totalRevenue.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Wallet className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">₦{avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    <p className="text-sm text-muted-foreground">Avg Order Value</p>
                  </div>
                </div>
              </CardContent>
            </Card>
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
              <CardTitle>All Customers ({filteredCustomers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">Name</th>
                      <th className="text-left py-3 px-4 font-medium">Phone</th>
                      <th className="text-left py-3 px-4 font-medium">Orders</th>
                      <th className="text-left py-3 px-4 font-medium">Total Spent</th>
                      <th className="text-left py-3 px-4 font-medium">Wallet</th>
                      <th className="text-left py-3 px-4 font-medium">Roles</th>
                      <th className="text-left py-3 px-4 font-medium">Joined</th>
                      <th className="text-left py-3 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCustomers.map((customer) => (
                      <tr key={customer.id} className="border-b hover:bg-secondary/50">
                        <td className="py-3 px-4 font-medium">{customer.full_name || 'N/A'}</td>
                        <td className="py-3 px-4">{customer.phone || 'N/A'}</td>
                        <td className="py-3 px-4">
                          <Badge variant="secondary">{customer.order_count}</Badge>
                        </td>
                        <td className="py-3 px-4 font-medium">
                          ₦{customer.total_spent.toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          ₦{customer.wallet_balance.toLocaleString()}
                         </td>
                         <td className="py-3 px-4">
                           <div className="flex flex-wrap gap-1">
                             {customer.roles.map(role => {
                               const roleConfig: Record<string, { label: string; className: string }> = {
                                 customer: { label: 'Customer', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
                                 vendor: { label: 'Vendor', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
                                 rider: { label: 'Rider', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
                                 delivery_company: { label: 'Logistics', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
                                 admin: { label: 'Admin', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
                               };
                               const config = roleConfig[role] || { label: role, className: 'bg-muted text-muted-foreground' };
                               return (
                                 <Badge key={role} variant="outline" className={`text-xs ${config.className}`}>
                                   {config.label}
                                 </Badge>
                               );
                             })}
                           </div>
                         </td>
                         <td className="py-3 px-4 text-muted-foreground">
                           {format(new Date(customer.created_at), 'PP')}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Load Wallet"
                              onClick={() => {
                                setSelectedCustomer(customer);
                                setLoadDialogOpen(true);
                              }}
                            >
                              <Plus className="w-4 h-4 text-primary mr-1" />
                              Load
                            </Button>
                            <AdminDeleteUserButton
                              userId={customer.user_id}
                              scope="all"
                              entityName={customer.full_name || customer.phone || 'customer'}
                              buttonLabel="Delete"
                              variant="ghost"
                              onDeleted={fetchCustomers}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-muted-foreground">
                          No customers found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                currentPage={custPage}
                totalPages={custTotalPages}
                onPageChange={setCustPage}
                totalItems={filteredCustomers.length}
                itemsPerPage={10}
              />
            </CardContent>
          </Card>
        

        {/* Load Wallet Dialog */}
        <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                Load Customer Wallet
              </DialogTitle>
              <DialogDescription>
                Manually credit {selectedCustomer?.full_name || 'customer'}'s wallet. This will be logged for audit.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="load-amount">Amount (₦)</Label>
                <Input
                  id="load-amount"
                  type="number"
                  min={1}
                  placeholder="Enter amount"
                  value={loadAmount}
                  onChange={(e) => setLoadAmount(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="load-reason">Reason *</Label>
                <Textarea
                  id="load-reason"
                  placeholder="e.g. Card payment not reflected, transfer receipt confirmed"
                  value={loadReason}
                  onChange={(e) => setLoadReason(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="load-reference">Payment Reference (optional)</Label>
                <Input
                  id="load-reference"
                  placeholder="e.g. Paystack ref or bank transfer ID"
                  value={loadReference}
                  onChange={(e) => setLoadReference(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleLoadWallet}
                disabled={loadingWallet || !loadAmount || !loadReason}
              >
                {loadingWallet ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
                ) : (
                  <><Plus className="w-4 h-4 mr-2" /> Credit Wallet</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </AdminLayout>
    );
  }