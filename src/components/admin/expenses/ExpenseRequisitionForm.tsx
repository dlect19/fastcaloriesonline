import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

interface Bank {
  name: string;
  code: string;
}

interface ExpenseRequisitionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const EXPENSE_CATEGORIES = [
  { value: 'nin_verification', label: 'NIN Verification (NinBVN Portal)' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'subscription', label: 'Subscriptions & Software' },
  { value: 'utility', label: 'Utilities' },
  { value: 'general', label: 'General / Other' },
];

export function ExpenseRequisitionForm({ onSuccess, onCancel }: ExpenseRequisitionFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { effectiveEnvironment } = useEnvironmentConfig();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('general');

  // Bank fields
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankDropdown, setShowBankDropdown] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchBanks = async () => {
      try {
        const { data } = await supabase.functions.invoke('paystack-list-banks');
        if (data?.success) setBanks(data.data || []);
      } catch (e) {
        console.error('Failed to load banks', e);
      } finally {
        setLoadingBanks(false);
      }
    };
    fetchBanks();
  }, []);

  const filteredBanks = banks.filter(b =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase())
  );

  const handleVerify = async () => {
    if (!selectedBank || accountNumber.length !== 10) return;
    setVerifying(true);
    try {
      const { data } = await supabase.functions.invoke('paystack-verify-bank', {
        body: { account_number: accountNumber, bank_code: selectedBank.code },
      });
      if (data?.success && data?.data?.account_name) {
        setAccountName(data.data.account_name);
        setVerified(true);
        toast({ title: 'Account verified!' });
      } else {
        throw new Error(data?.error || 'Verification failed');
      }
    } catch (e: any) {
      toast({ title: 'Verification failed', description: e.message, variant: 'destructive' });
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async () => {
    if (!title || !amount || !selectedBank || !verified) {
      toast({ title: 'Please fill all required fields and verify the account', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      // Get user's display name from admin_staff or profile
      const { data: staffData } = await supabase
        .from('admin_staff')
        .select('invite_email')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .maybeSingle();

      const requesterName = staffData?.invite_email || user!.email || 'Unknown';

      const { error } = await supabase.from('expense_requisitions').insert({
        title,
        description,
        amount: parseFloat(amount),
        category,
        bank_name: selectedBank.name,
        bank_code: selectedBank.code,
        account_number: accountNumber,
        account_name: accountName,
        requested_by: user!.id,
        requested_by_name: requesterName,
        environment: effectiveEnvironment,
      });

      if (error) throw error;

      toast({ title: 'Requisition submitted successfully!' });
      onSuccess();
    } catch (e: any) {
      toast({ title: 'Failed to submit', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="space-y-2">
        <Label>Title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Office chairs purchase" />
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <Label>Amount (₦) *</Label>
        <Input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
          min="1"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Why is this expense needed?" rows={3} />
      </div>

      {/* Bank Selection */}
      <div className="space-y-2">
        <Label>Recipient Bank *</Label>
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={loadingBanks ? 'Loading banks...' : 'Search bank...'}
              value={bankSearch}
              onChange={e => {
                setBankSearch(e.target.value);
                setShowBankDropdown(true);
                if (selectedBank && e.target.value !== selectedBank.name) {
                  setSelectedBank(null);
                  setVerified(false);
                  setAccountName('');
                }
              }}
              onFocus={() => setShowBankDropdown(true)}
              className="pl-9"
              disabled={loadingBanks}
            />
          </div>
          {showBankDropdown && !loadingBanks && (
            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg">
              <ScrollArea className="h-[200px]">
                {filteredBanks.length > 0 ? filteredBanks.map(bank => (
                  <button
                    key={bank.code}
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm transition-colors"
                    onClick={() => {
                      setSelectedBank(bank);
                      setBankSearch(bank.name);
                      setShowBankDropdown(false);
                      setVerified(false);
                      setAccountName('');
                    }}
                  >
                    {bank.name}
                  </button>
                )) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No banks found</div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>
      </div>

      {/* Account Number */}
      <div className="space-y-2">
        <Label>Account Number *</Label>
        <div className="flex gap-2">
          <Input
            value={accountNumber}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 10);
              setAccountNumber(v);
              setVerified(false);
              setAccountName('');
            }}
            placeholder="10-digit account number"
            maxLength={10}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handleVerify}
            disabled={!selectedBank || accountNumber.length !== 10 || verifying}
            variant={verified ? 'default' : 'secondary'}
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : verified ? <CheckCircle className="h-4 w-4" /> : 'Verify'}
          </Button>
        </div>
      </div>

      {/* Verified Account */}
      {verified && accountName && (
        <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-primary">{accountName}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1" disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting || !verified || !title || !amount} className="flex-1">
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting...</> : 'Submit Requisition'}
        </Button>
      </div>
    </div>
  );
}
