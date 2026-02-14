import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Play, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PayrollEmployee {
  id: string;
  full_name: string;
  email: string | null;
  base_salary: number;
  bank_name: string | null;
  bank_account_number: string | null;
  paystack_recipient_code: string | null;
  is_active: boolean;
}

interface PayrollItem {
  employeeId: string;
  name: string;
  baseSalary: number;
  bonus: number;
  bonusNote: string;
  deductions: number;
  deductionNote: string;
  netPay: number;
  hasBank: boolean;
}

interface PayrollRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function PayrollRunDialog({ open, onOpenChange, onSuccess }: PayrollRunDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<'configure' | 'review' | 'processing'>('configure');
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  // Config
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  useEffect(() => {
    if (open) {
      fetchEmployees();
      setStep('configure');
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setTitle(`Payroll - ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`);
      setPeriodStart(firstDay.toISOString().split('T')[0]);
      setPeriodEnd(lastDay.toISOString().split('T')[0]);
    }
  }, [open]);

  const fetchEmployees = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('payroll_employees')
      .select('*')
      .eq('is_active', true)
      .order('full_name');
    
    if (data) {
      const emps = data as unknown as PayrollEmployee[];
      setEmployees(emps);
      setItems(emps.map(emp => ({
        employeeId: emp.id,
        name: emp.full_name,
        baseSalary: Number(emp.base_salary),
        bonus: 0,
        bonusNote: '',
        deductions: 0,
        deductionNote: '',
        netPay: Number(emp.base_salary),
        hasBank: !!emp.paystack_recipient_code,
      })));
    }
    setLoading(false);
  };

  const updateItem = (idx: number, field: keyof PayrollItem, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      (updated[idx] as any)[field] = value;
      updated[idx].netPay = updated[idx].baseSalary + updated[idx].bonus - updated[idx].deductions;
      return updated;
    });
  };

  const totalGross = items.reduce((s, i) => s + i.baseSalary + i.bonus, 0);
  const totalDeductions = items.reduce((s, i) => s + i.deductions, 0);
  const totalNet = items.reduce((s, i) => s + i.netPay, 0);
  const employeesWithoutBank = items.filter(i => !i.hasBank);

  const handleProcess = async () => {
    if (!title || !periodStart || !periodEnd) {
      toast({ title: 'Please fill all fields', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'No employees to process', variant: 'destructive' });
      return;
    }

    setProcessing(true);
    setStep('processing');

    try {
      const { data, error } = await supabase.functions.invoke('process-payroll', {
        body: {
          title,
          periodStart,
          periodEnd,
          items: items.map(i => ({
            payroll_employee_id: i.employeeId,
            employee_name: i.name,
            base_salary: i.baseSalary,
            bonus: i.bonus,
            bonus_note: i.bonusNote,
            deductions: i.deductions,
            deduction_note: i.deductionNote,
            net_pay: i.netPay,
          })),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Payroll Processed!',
        description: data?.message || `${data?.processed || 0} payments initiated`,
      });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Payroll Failed', description: err.message, variant: 'destructive' });
      setStep('review');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'configure' && 'Configure Payroll Run'}
            {step === 'review' && 'Review & Confirm'}
            {step === 'processing' && 'Processing Payroll...'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : step === 'configure' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Payroll Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div>
                <Label>Period Start</Label>
                <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <Label>Period End</Label>
                <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
            </div>

            {employeesWithoutBank.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {employeesWithoutBank.length} employee(s) have no bank account set up and will be skipped: {employeesWithoutBank.map(e => e.name).join(', ')}
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Base Salary</TableHead>
                  <TableHead>Bonus (₦)</TableHead>
                  <TableHead>Bonus Note</TableHead>
                  <TableHead>Deductions (₦)</TableHead>
                  <TableHead>Deduction Note</TableHead>
                  <TableHead>Net Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={item.employeeId} className={!item.hasBank ? 'opacity-50' : ''}>
                    <TableCell>
                      <div>
                        <span className="font-medium">{item.name}</span>
                        {!item.hasBank && <Badge variant="destructive" className="ml-2 text-xs">No bank</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>₦{item.baseSalary.toLocaleString()}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.bonus || ''}
                        onChange={e => updateItem(idx, 'bonus', Number(e.target.value) || 0)}
                        className="w-24"
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.bonusNote}
                        onChange={e => updateItem(idx, 'bonusNote', e.target.value)}
                        className="w-32"
                        placeholder="Optional"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.deductions || ''}
                        onChange={e => updateItem(idx, 'deductions', Number(e.target.value) || 0)}
                        className="w-24"
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.deductionNote}
                        onChange={e => updateItem(idx, 'deductionNote', e.target.value)}
                        className="w-32"
                        placeholder="Optional"
                      />
                    </TableCell>
                    <TableCell className="font-bold">₦{item.netPay.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-between items-center p-4 bg-muted rounded-lg">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Gross: ₦{totalGross.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Deductions: ₦{totalDeductions.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total Net Pay</p>
                <p className="text-2xl font-bold">₦{totalNet.toLocaleString()}</p>
              </div>
            </div>
          </div>
        ) : step === 'review' ? (
          <div className="space-y-4">
            <p className="text-muted-foreground">Review the payroll details below before processing.</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground">Title</Label><p className="font-medium">{title}</p></div>
              <div><Label className="text-muted-foreground">Period</Label><p className="font-medium">{periodStart} to {periodEnd}</p></div>
              <div><Label className="text-muted-foreground">Employees</Label><p className="font-medium">{items.filter(i => i.hasBank).length}</p></div>
              <div><Label className="text-muted-foreground">Total Net Pay</Label><p className="font-medium text-lg">₦{totalNet.toLocaleString()}</p></div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Processing payroll transfers via Paystack...</p>
          </div>
        )}

        <DialogFooter>
          {step === 'configure' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep('review')} disabled={items.length === 0}>
                Review Payroll
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={() => setStep('configure')}>Back</Button>
              <Button onClick={handleProcess} disabled={processing} className="gap-2">
                <Play className="w-4 h-4" />
                Process Payroll
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
