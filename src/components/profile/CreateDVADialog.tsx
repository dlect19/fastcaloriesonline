import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Building2, CheckCircle2, AlertCircle, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CreateDVADialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileComplete: boolean;
  onSuccess: () => void;
}

type Step = 'intro' | 'creating-customer' | 'creating-dva' | 'success' | 'error';

export function CreateDVADialog({ open, onOpenChange, profileComplete, onSuccess }: CreateDVADialogProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState<string | null>(null);
  const [dvaDetails, setDvaDetails] = useState<{
    bankName: string;
    accountNumber: string;
    accountName: string;
  } | null>(null);

  const handleCreateDVA = async () => {
    setError(null);
    
    try {
      // Step 1: Create Paystack customer
      setStep('creating-customer');
      
      const { data: customerData, error: customerError } = await supabase.functions.invoke(
        'paystack-create-customer'
      );

      if (customerError) throw new Error(customerError.message);
      if (customerData?.error) throw new Error(customerData.error);

      console.log('Customer created:', customerData);

      // Step 2: Create DVA
      setStep('creating-dva');
      
      const { data: dvaData, error: dvaError } = await supabase.functions.invoke(
        'paystack-create-dva'
      );

      if (dvaError) throw new Error(dvaError.message);
      if (dvaData?.error) throw new Error(dvaData.message || dvaData.error);

      console.log('DVA created:', dvaData);

      setDvaDetails({
        bankName: dvaData.bank_name,
        accountNumber: dvaData.account_number,
        accountName: dvaData.account_name,
      });
      setStep('success');
      
      toast({
        title: 'Virtual Account Created!',
        description: 'You can now fund your wallet via bank transfer.',
      });

      onSuccess();
    } catch (err) {
      console.error('DVA creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create virtual account');
      setStep('error');
    }
  };

  const handleClose = () => {
    setStep('intro');
    setError(null);
    setDvaDetails(null);
    onOpenChange(false);
  };

  const renderContent = () => {
    if (!profileComplete) {
      return (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Complete Your Profile
            </DialogTitle>
            <DialogDescription>
              To create a virtual account, we need your complete profile information.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Please update your profile with your full name and phone number to continue.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button 
                onClick={() => {
                  handleClose();
                  navigate('/profile');
                }} 
                className="flex-1"
              >
                Update Profile
              </Button>
            </div>
          </div>
        </>
      );
    }

    switch (step) {
      case 'intro':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Get Your Virtual Account
              </DialogTitle>
              <DialogDescription>
                Get a dedicated bank account number to fund your wallet via bank transfer.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                <h4 className="font-medium">How it works:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• You'll get a unique account number (Wema Bank)</li>
                  <li>• Transfer any amount to this account</li>
                  <li>• Your wallet is credited automatically</li>
                  <li>• No fees for bank transfers</li>
                </ul>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleCreateDVA} className="flex-1">
                  Create Account
                </Button>
              </div>
            </div>
          </>
        );

      case 'creating-customer':
      case 'creating-dva':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating Virtual Account
              </DialogTitle>
            </DialogHeader>
            <div className="py-8 flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
              <p className="text-muted-foreground text-center">
                {step === 'creating-customer' 
                  ? 'Setting up your account...' 
                  : 'Creating your virtual account...'}
              </p>
            </div>
          </>
        );

      case 'success':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-primary">
                <CheckCircle2 className="w-5 h-5" />
                Virtual Account Created!
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {dvaDetails && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bank</span>
                    <span className="font-medium">{dvaDetails.bankName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account Number</span>
                    <span className="font-mono font-bold">{dvaDetails.accountNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account Name</span>
                    <span className="font-medium text-sm">{dvaDetails.accountName}</span>
                  </div>
                </div>
              )}
              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            </div>
          </>
        );

      case 'error':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-5 h-5" />
                Failed to Create Account
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={() => setStep('intro')} className="flex-1">
                  Try Again
                </Button>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
