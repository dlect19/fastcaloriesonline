import { useState, useEffect } from 'react';
import { Search, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Bank {
  name: string;
  code: string;
  type: string;
}

interface BankAccountFormProps {
  onSuccess: (data: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    recipientCode: string;
  }) => void;
  onCancel: () => void;
  existingBank?: string;
  existingAccountNumber?: string;
}

export function BankAccountForm({
  onSuccess,
  onCancel,
  existingBank,
  existingAccountNumber,
}: BankAccountFormProps) {
  const { toast } = useToast();
  
  // Bank list state
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [showBankDropdown, setShowBankDropdown] = useState(false);
  
  // Selected bank state
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  
  // Account details state
  const [accountNumber, setAccountNumber] = useState(existingAccountNumber || '');
  const [accountName, setAccountName] = useState('');
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const [verificationError, setVerificationError] = useState('');
  
  // Saving state
  const [saving, setSaving] = useState(false);

  // Fetch banks on mount
  useEffect(() => {
    fetchBanks();
  }, []);

  // Pre-select existing bank if provided
  useEffect(() => {
    if (existingBank && banks.length > 0) {
      const found = banks.find(b => b.name === existingBank);
      if (found) {
        setSelectedBank(found);
        setBankSearchQuery(found.name);
      }
    }
  }, [existingBank, banks]);

  const fetchBanks = async () => {
    setLoadingBanks(true);
    try {
      const { data, error } = await supabase.functions.invoke('paystack-list-banks');
      
      if (error) throw error;
      
      if (data?.success && data?.data) {
        setBanks(data.data);
      } else {
        throw new Error(data?.error || 'Failed to fetch banks');
      }
    } catch (error: any) {
      console.error('Error fetching banks:', error);
      toast({
        title: 'Failed to load banks',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoadingBanks(false);
    }
  };

  const handleBankSelect = (bank: Bank) => {
    setSelectedBank(bank);
    setBankSearchQuery(bank.name);
    setShowBankDropdown(false);
    // Reset verification when bank changes
    setVerificationStatus('idle');
    setAccountName('');
  };

  const handleAccountNumberChange = (value: string) => {
    // Only allow digits
    const cleaned = value.replace(/\D/g, '').slice(0, 10);
    setAccountNumber(cleaned);
    // Reset verification when account number changes
    setVerificationStatus('idle');
    setAccountName('');
  };

  const handleVerifyAccount = async () => {
    if (!selectedBank) {
      toast({ title: 'Please select a bank first', variant: 'destructive' });
      return;
    }

    if (accountNumber.length !== 10) {
      toast({ title: 'Account number must be 10 digits', variant: 'destructive' });
      return;
    }

    setVerificationStatus('verifying');
    setVerificationError('');

    try {
      const { data, error } = await supabase.functions.invoke('paystack-verify-bank', {
        body: {
          account_number: accountNumber,
          bank_code: selectedBank.code,
        },
      });

      if (error) throw error;

      if (data?.success && data?.data?.account_name) {
        setAccountName(data.data.account_name);
        setVerificationStatus('verified');
        toast({ title: 'Account verified successfully!' });
      } else {
        throw new Error(data?.error || 'Could not verify account');
      }
    } catch (error: any) {
      console.error('Verification error:', error);
      setVerificationStatus('error');
      setVerificationError(error.message || 'Failed to verify account');
      toast({
        title: 'Verification failed',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleSave = async () => {
    if (!selectedBank || !accountNumber || !accountName) {
      toast({ title: 'Please complete verification first', variant: 'destructive' });
      return;
    }

    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('paystack-create-recipient', {
        body: {
          account_number: accountNumber,
          bank_code: selectedBank.code,
          account_name: accountName,
          bank_name: selectedBank.name,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast({ title: 'Bank account saved successfully!' });
        onSuccess({
          bankName: selectedBank.name,
          bankCode: selectedBank.code,
          accountNumber,
          accountName,
          recipientCode: data.data.recipient_code,
        });
      } else {
        throw new Error(data?.error || 'Failed to save bank account');
      }
    } catch (error: any) {
      console.error('Save error:', error);
      toast({
        title: 'Failed to save bank account',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const filteredBanks = banks.filter(bank =>
    bank.name.toLowerCase().includes(bankSearchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Bank Selection */}
      <div className="space-y-2">
        <Label>Select Bank</Label>
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={loadingBanks ? "Loading banks..." : "Search for your bank..."}
              value={bankSearchQuery}
              onChange={(e) => {
                setBankSearchQuery(e.target.value);
                setShowBankDropdown(true);
                if (selectedBank && e.target.value !== selectedBank.name) {
                  setSelectedBank(null);
                  setVerificationStatus('idle');
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
                {filteredBanks.length > 0 ? (
                  filteredBanks.map((bank) => (
                    <button
                      key={bank.code}
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm transition-colors"
                      onClick={() => handleBankSelect(bank)}
                    >
                      {bank.name}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No banks found
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>
        {selectedBank && (
          <p className="text-sm text-muted-foreground">
            Bank code: {selectedBank.code}
          </p>
        )}
      </div>

      {/* Account Number */}
      <div className="space-y-2">
        <Label>Account Number</Label>
        <div className="flex gap-2">
          <Input
            value={accountNumber}
            onChange={(e) => handleAccountNumberChange(e.target.value)}
            placeholder="Enter 10-digit account number"
            maxLength={10}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handleVerifyAccount}
            disabled={!selectedBank || accountNumber.length !== 10 || verificationStatus === 'verifying'}
            variant={verificationStatus === 'verified' ? 'default' : 'secondary'}
          >
            {verificationStatus === 'verifying' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : verificationStatus === 'verified' ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              'Verify'
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {accountNumber.length}/10 digits
        </p>
      </div>

      {/* Verification Result */}
      {verificationStatus === 'verified' && accountName && (
        <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Account Verified</span>
          </div>
          <p className="mt-1 text-primary font-semibold">{accountName}</p>
        </div>
      )}

      {verificationStatus === 'error' && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">Verification Failed</span>
          </div>
          <p className="mt-1 text-destructive/80 text-sm">{verificationError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          onClick={onCancel}
          className="flex-1"
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={verificationStatus !== 'verified' || saving}
          className="flex-1"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            'Save Bank Account'
          )}
        </Button>
      </div>
    </div>
  );
}
