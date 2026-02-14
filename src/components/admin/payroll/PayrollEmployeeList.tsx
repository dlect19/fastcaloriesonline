import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BankAccountForm } from '@/components/BankAccountForm';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Building2, Loader2, UserPlus } from 'lucide-react';

interface PayrollEmployee {
  id: string;
  admin_staff_id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  base_salary: number;
  bank_account_number: string | null;
  bank_code: string | null;
  bank_name: string | null;
  paystack_recipient_code: string | null;
  is_active: boolean;
}

interface AdminStaffOption {
  id: string;
  user_id: string;
  role: string;
  invite_email: string | null;
}

export function PayrollEmployeeList() {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<PayrollEmployee | null>(null);
  const [bankDialogEmployee, setBankDialogEmployee] = useState<PayrollEmployee | null>(null);
  const [availableStaff, setAvailableStaff] = useState<AdminStaffOption[]>([]);
  
  // Form state
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('payroll_employees')
      .select('*')
      .order('full_name');
    
    if (!error && data) setEmployees(data as unknown as PayrollEmployee[]);
    setLoading(false);
  };

  const fetchAvailableStaff = async () => {
    // Get admin staff not yet in payroll
    const { data: existingIds } = await supabase
      .from('payroll_employees')
      .select('admin_staff_id');
    
    const usedIds = (existingIds || []).map((e: any) => e.admin_staff_id);
    
    const { data: staff } = await supabase
      .from('admin_staff')
      .select('id, user_id, role, invite_email')
      .eq('is_active', true);
    
    if (staff) {
      setAvailableStaff(
        (staff as unknown as AdminStaffOption[]).filter(s => !usedIds.includes(s.id))
      );
    }
  };

  const openAddDialog = async () => {
    await fetchAvailableStaff();
    setSelectedStaffId('');
    setFullName('');
    setEmail('');
    setBaseSalary('');
    setAddDialogOpen(true);
  };

  const openEditDialog = (emp: PayrollEmployee) => {
    setEditEmployee(emp);
    setFullName(emp.full_name);
    setEmail(emp.email || '');
    setBaseSalary(String(emp.base_salary));
  };

  const handleSave = async () => {
    if (!fullName || !baseSalary) {
      toast({ title: 'Please fill required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    try {
      if (editEmployee) {
        const { error } = await supabase
          .from('payroll_employees')
          .update({
            full_name: fullName,
            email: email || null,
            base_salary: Number(baseSalary),
            updated_at: new Date().toISOString(),
          })
          .eq('id', editEmployee.id);
        if (error) throw error;
        toast({ title: 'Employee updated' });
        setEditEmployee(null);
      } else {
        if (!selectedStaffId) {
          toast({ title: 'Please select a staff member', variant: 'destructive' });
          setSaving(false);
          return;
        }
        const staff = availableStaff.find(s => s.id === selectedStaffId);
        if (!staff) return;

        const { error } = await supabase
          .from('payroll_employees')
          .insert({
            admin_staff_id: staff.id,
            user_id: staff.user_id,
            full_name: fullName,
            email: email || staff.invite_email || null,
            base_salary: Number(baseSalary),
          });
        if (error) throw error;
        toast({ title: 'Employee added to payroll' });
        setAddDialogOpen(false);
      }
      fetchEmployees();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleBankSaved = async (data: { bankName: string; bankCode: string; accountNumber: string; accountName: string; recipientCode: string }) => {
    if (!bankDialogEmployee) return;
    
    await supabase
      .from('payroll_employees')
      .update({
        bank_name: data.bankName,
        bank_code: data.bankCode,
        bank_account_number: data.accountNumber,
        paystack_recipient_code: data.recipientCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bankDialogEmployee.id);
    
    setBankDialogEmployee(null);
    fetchEmployees();
    toast({ title: 'Bank account saved for employee' });
  };

  const toggleActive = async (emp: PayrollEmployee) => {
    await supabase
      .from('payroll_employees')
      .update({ is_active: !emp.is_active, updated_at: new Date().toISOString() })
      .eq('id', emp.id);
    fetchEmployees();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Payroll Employees</CardTitle>
          <Button onClick={openAddDialog} size="sm" className="gap-2">
            <UserPlus className="w-4 h-4" />
            Add Employee
          </Button>
        </CardHeader>
        <CardContent>
          {employees.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No employees added to payroll yet. Add admin staff to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Base Salary</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map(emp => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-medium">{emp.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{emp.email || '—'}</TableCell>
                    <TableCell>₦{Number(emp.base_salary).toLocaleString()}</TableCell>
                    <TableCell>
                      {emp.bank_name ? (
                        <span className="text-sm">{emp.bank_name} • {emp.bank_account_number}</span>
                      ) : (
                        <Badge variant="outline" className="text-xs">No bank</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={emp.is_active ? 'default' : 'secondary'}>
                        {emp.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(emp)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setBankDialogEmployee(emp)}>
                          <Building2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(emp)}>
                          {emp.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Employee Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employee to Payroll</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Admin Staff Member</Label>
              <select
                className="w-full mt-1 px-3 py-2 border border-border rounded-md bg-background text-foreground"
                value={selectedStaffId}
                onChange={e => {
                  setSelectedStaffId(e.target.value);
                  const s = availableStaff.find(x => x.id === e.target.value);
                  if (s?.invite_email) setEmail(s.invite_email);
                }}
              >
                <option value="">Select staff member...</option>
                {availableStaff.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.invite_email || s.user_id} ({s.role})
                  </option>
                ))}
              </select>
              {availableStaff.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">All staff are already in payroll</p>
              )}
            </div>
            <div>
              <Label>Full Name *</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Employee full name" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="employee@email.com" />
            </div>
            <div>
              <Label>Base Salary (₦) *</Label>
              <Input type="number" value={baseSalary} onChange={e => setBaseSalary(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Employee Dialog */}
      <Dialog open={!!editEmployee} onOpenChange={() => setEditEmployee(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Base Salary (₦) *</Label>
              <Input type="number" value={baseSalary} onChange={e => setBaseSalary(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEmployee(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bank Account Dialog */}
      <Dialog open={!!bankDialogEmployee} onOpenChange={() => setBankDialogEmployee(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Bank Account — {bankDialogEmployee?.full_name}</DialogTitle>
          </DialogHeader>
          <BankAccountForm
            onSuccess={handleBankSaved}
            onCancel={() => setBankDialogEmployee(null)}
            existingBank={bankDialogEmployee?.bank_name || undefined}
            existingAccountNumber={bankDialogEmployee?.bank_account_number || undefined}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
