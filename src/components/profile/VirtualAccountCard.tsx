import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface VirtualAccountCardProps {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export function VirtualAccountCard({ bankName, accountNumber, accountName }: VirtualAccountCardProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(accountNumber);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: 'Account number copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Please copy manually',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="border-0 shadow-soft bg-gradient-to-br from-primary/10 to-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium text-muted-foreground">
          <Building2 className="w-5 h-5" />
          Your Virtual Account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Transfer money to this account to fund your wallet instantly
        </div>
        
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Bank</span>
            <span className="font-medium">{bankName}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Account Number</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-lg">{accountNumber}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Account Name</span>
            <span className="font-medium text-sm">{accountName}</span>
          </div>
        </div>

        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            💡 Bank transfers are credited automatically within minutes
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
