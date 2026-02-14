import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Eye, Download, FileText } from 'lucide-react';
import { format } from 'date-fns';

interface PayrollRun {
  id: string;
  title: string;
  pay_period_start: string;
  pay_period_end: string;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_employees: number;
  processed_count: number;
  failed_count: number;
  created_at: string;
  processed_at: string | null;
}

interface PayrollItem {
  id: string;
  employee_name: string;
  base_salary: number;
  bonus: number;
  bonus_note: string | null;
  deductions: number;
  deduction_note: string | null;
  net_pay: number;
  status: string;
  failure_reason: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  paystack_reference: string | null;
}

const statusColors: Record<string, string> = {
  draft: 'secondary',
  processing: 'default',
  completed: 'default',
  failed: 'destructive',
  partial: 'outline',
  pending: 'secondary',
  skipped: 'outline',
};

export function PayrollHistory() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [runItems, setRunItems] = useState<PayrollItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => { fetchRuns(); }, []);

  const fetchRuns = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('payroll_runs')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setRuns(data as unknown as PayrollRun[]);
    setLoading(false);
  };

  const viewDetails = async (run: PayrollRun) => {
    setSelectedRun(run);
    setLoadingItems(true);
    const { data } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('payroll_run_id', run.id)
      .order('employee_name');
    if (data) setRunItems(data as unknown as PayrollItem[]);
    setLoadingItems(false);
  };

  const generatePayslipText = (item: PayrollItem, run: PayrollRun) => {
    const lines = [
      `═══════════════════════════════`,
      `         PAYSLIP`,
      `═══════════════════════════════`,
      `Employee: ${item.employee_name}`,
      `Period: ${run.pay_period_start} to ${run.pay_period_end}`,
      `Payroll: ${run.title}`,
      `───────────────────────────────`,
      `Base Salary:    ₦${Number(item.base_salary).toLocaleString()}`,
    ];
    if (Number(item.bonus) > 0) {
      lines.push(`Bonus:          ₦${Number(item.bonus).toLocaleString()}${item.bonus_note ? ` (${item.bonus_note})` : ''}`);
    }
    if (Number(item.deductions) > 0) {
      lines.push(`Deductions:    -₦${Number(item.deductions).toLocaleString()}${item.deduction_note ? ` (${item.deduction_note})` : ''}`);
    }
    lines.push(
      `───────────────────────────────`,
      `NET PAY:        ₦${Number(item.net_pay).toLocaleString()}`,
      `───────────────────────────────`,
      `Status: ${item.status.toUpperCase()}`,
      `Bank: ${item.bank_name || 'N/A'} • ${item.bank_account_number || 'N/A'}`,
      `Reference: ${item.paystack_reference || 'N/A'}`,
      `═══════════════════════════════`,
    );
    return lines.join('\n');
  };

  const downloadPayslip = (item: PayrollItem) => {
    if (!selectedRun) return;
    const text = generatePayslipText(item, selectedRun);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payslip-${item.employee_name.replace(/\s+/g, '-')}-${selectedRun.pay_period_end}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
        <CardHeader>
          <CardTitle>Payroll History</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No payroll runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Total Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(run => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {run.pay_period_start} — {run.pay_period_end}
                    </TableCell>
                    <TableCell>
                      {run.processed_count}/{run.total_employees}
                      {run.failed_count > 0 && (
                        <span className="text-destructive ml-1">({run.failed_count} failed)</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">₦{Number(run.total_net).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={statusColors[run.status] as any || 'secondary'}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(run.created_at), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => viewDetails(run)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Run Details Dialog */}
      <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedRun?.title} — Details</DialogTitle>
          </DialogHeader>
          {loadingItems ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>Bonus</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payslip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runItems.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.employee_name}</TableCell>
                    <TableCell>₦{Number(item.base_salary).toLocaleString()}</TableCell>
                    <TableCell>
                      {Number(item.bonus) > 0 ? `₦${Number(item.bonus).toLocaleString()}` : '—'}
                      {item.bonus_note && <span className="text-xs text-muted-foreground ml-1">({item.bonus_note})</span>}
                    </TableCell>
                    <TableCell>
                      {Number(item.deductions) > 0 ? `₦${Number(item.deductions).toLocaleString()}` : '—'}
                      {item.deduction_note && <span className="text-xs text-muted-foreground ml-1">({item.deduction_note})</span>}
                    </TableCell>
                    <TableCell className="font-bold">₦{Number(item.net_pay).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={statusColors[item.status] as any || 'secondary'}>
                        {item.status}
                      </Badge>
                      {item.failure_reason && (
                        <p className="text-xs text-destructive mt-1">{item.failure_reason}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => downloadPayslip(item)}>
                        <FileText className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
