 import { useState } from 'react';
 import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
   DialogTrigger,
 } from '@/components/ui/dialog';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
 import { Badge } from '@/components/ui/badge';
 import { AlertTriangle, Trash2, Loader2, FlaskConical, Globe } from 'lucide-react';
 import { supabase } from '@/integrations/supabase/client';
 import { toast } from 'sonner';
 
 interface FinancialResetDialogProps {
   onResetComplete?: () => void;
 }
 
 export function FinancialResetDialog({ onResetComplete }: FinancialResetDialogProps) {
   const [open, setOpen] = useState(false);
   const [selectedEnvironment, setSelectedEnvironment] = useState<'development' | 'production'>('development');
   const [confirmationText, setConfirmationText] = useState('');
   const [loading, setLoading] = useState(false);
 
   const requiredConfirmation = selectedEnvironment === 'development' 
     ? 'RESET DEVELOPMENT' 
     : 'RESET PRODUCTION';
 
   const isConfirmed = confirmationText === requiredConfirmation;
 
   const handleReset = async () => {
     if (!isConfirmed) return;
 
     setLoading(true);
     try {
       const { data, error } = await supabase.functions.invoke('reset-financial-data', {
         body: { environment: selectedEnvironment },
       });
 
       if (error) throw error;
 
       toast.success(`${selectedEnvironment === 'development' ? 'Development' : 'Production'} financial data reset successfully`, {
         description: `Cleared ${data?.deletedTransactions || 0} transactions, ${data?.deletedFinancials || 0} order financials, ${data?.deletedPayouts || 0} payouts`,
       });
 
       setOpen(false);
       setConfirmationText('');
       onResetComplete?.();
     } catch (error: any) {
       console.error('Reset error:', error);
       toast.error('Failed to reset financial data', {
         description: error.message || 'Please try again',
       });
     } finally {
       setLoading(false);
     }
   };
 
   return (
     <Dialog open={open} onOpenChange={(o) => {
       setOpen(o);
       if (!o) {
         setConfirmationText('');
       }
     }}>
       <DialogTrigger asChild>
         <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10">
           <Trash2 className="w-4 h-4 mr-2" />
           Reset Financial Data
         </Button>
       </DialogTrigger>
       <DialogContent className="sm:max-w-md">
         <DialogHeader>
           <DialogTitle className="flex items-center gap-2 text-destructive">
             <AlertTriangle className="w-5 h-5" />
             Reset Financial Data
           </DialogTitle>
           <DialogDescription>
              This will permanently delete transaction history, order financials, payout requests, and promo stats for the selected environment. Wallet balances and orders are NOT affected.
           </DialogDescription>
         </DialogHeader>
 
         <div className="space-y-6 py-4">
           {/* Environment Selection */}
           <div className="space-y-3">
             <Label>Select Environment to Reset</Label>
             <RadioGroup
               value={selectedEnvironment}
               onValueChange={(v) => {
                 setSelectedEnvironment(v as 'development' | 'production');
                 setConfirmationText('');
               }}
               className="grid grid-cols-2 gap-4"
             >
               <div>
                 <RadioGroupItem
                   value="development"
                   id="env-dev"
                   className="peer sr-only"
                 />
                 <Label
                   htmlFor="env-dev"
                   className="flex flex-col items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-warning [&:has([data-state=checked])]:border-warning cursor-pointer"
                 >
                   <FlaskConical className="w-6 h-6 mb-2 text-warning" />
                   <span className="font-medium">Development</span>
                   <span className="text-xs text-muted-foreground">Test data</span>
                 </Label>
               </div>
               <div>
                 <RadioGroupItem
                   value="production"
                   id="env-prod"
                   className="peer sr-only"
                 />
                 <Label
                   htmlFor="env-prod"
                   className="flex flex-col items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-success [&:has([data-state=checked])]:border-success cursor-pointer"
                 >
                   <Globe className="w-6 h-6 mb-2 text-success" />
                   <span className="font-medium">Production</span>
                   <span className="text-xs text-muted-foreground">Live data</span>
                 </Label>
               </div>
             </RadioGroup>
           </div>
 
           {/* What will be deleted */}
           <div className="space-y-2">
              <Label className="text-destructive">What will be deleted:</Label>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside mb-3">
                <li>All wallet transactions</li>
                <li>Order financial records</li>
                <li>Payout requests</li>
                <li>Promo usage logs</li>
                <li>Daily promo stats</li>
              </ul>
              <p className="text-xs text-success font-medium">
                ✓ Wallet balances and orders are preserved.
              </p>
           </div>
 
           {/* Confirmation Input */}
           <div className="space-y-2">
             <Label htmlFor="confirmation">
               Type <Badge variant="outline" className="mx-1 font-mono">{requiredConfirmation}</Badge> to confirm
             </Label>
             <Input
               id="confirmation"
               value={confirmationText}
               onChange={(e) => setConfirmationText(e.target.value)}
               placeholder={requiredConfirmation}
               className="font-mono"
             />
           </div>
 
           {/* Reset Button */}
           <Button
             variant="destructive"
             className="w-full"
             disabled={!isConfirmed || loading}
             onClick={handleReset}
           >
             {loading ? (
               <>
                 <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                 Resetting...
               </>
             ) : (
               <>
                 <Trash2 className="w-4 h-4 mr-2" />
                 Reset {selectedEnvironment === 'development' ? 'Development' : 'Production'} Data
               </>
             )}
           </Button>
         </div>
       </DialogContent>
     </Dialog>
   );
 }