import { useState } from 'react';
import { Copy, FileText, Loader2, MapPin, UtensilsCrossed, Pill } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useOutletContext } from '@/hooks/useOutletContext';
import { StoreTypeField, type StoreType, type SocialMediaHandles } from '@/components/vendor/StoreTypeField';

interface AddOutletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
}

type Step = 'type' | 'choose' | 'form';
type Mode = 'copy' | 'scratch';
type OutletType = 'restaurant' | 'pharmacy';

export function AddOutletDialog({ open, onOpenChange, vendorId }: AddOutletDialogProps) {
  const { toast } = useToast();
  const { outlets, refreshOutlets } = useOutletContext();
  const [step, setStep] = useState<Step>('type');
  const [mode, setMode] = useState<Mode>('scratch');
  const [outletType, setOutletType] = useState<OutletType>('restaurant');
  const [saving, setSaving] = useState(false);

  const defaultOutlet = outlets.find(o => o.is_default);
  const nextCode = `Store ${outlets.length + 1}`;

  const [storeType, setStoreType] = useState<StoreType>('physical');
  const [socialHandles, setSocialHandles] = useState<SocialMediaHandles>({});

  const [formData, setFormData] = useState({
    outlet_name: '',
    outlet_surname: '',
    address: '',
    city: '',
    state: '',
  });

  const handleTypeSelect = (type: OutletType) => {
    setOutletType(type);
    setStep('choose');
  };

  const handleChoose = (m: Mode) => {
    setMode(m);
    if (m === 'copy' && defaultOutlet) {
      setFormData({
        outlet_name: defaultOutlet.outlet_name || 'New Outlet',
        outlet_surname: '',
        address: defaultOutlet.address || '',
        city: defaultOutlet.city || '',
        state: defaultOutlet.state || '',
      });
    } else {
      setFormData({ outlet_name: '', outlet_surname: '', address: '', city: '', state: '' });
    }
    setStoreType('physical');
    setSocialHandles({});
    setStep('form');
  };

  const handleSubmit = async () => {
    if (!formData.outlet_name || !formData.address || !formData.city || !formData.state) {
      toast({ title: 'Please fill all required fields', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const insertPayload = {
        vendor_id: vendorId,
        outlet_name: formData.outlet_name,
        outlet_surname: formData.outlet_surname || formData.city,
        outlet_code: nextCode,
        is_default: false,
        is_approved: false,
        is_active: false,
        is_open: false,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        delivery_mode: (mode === 'copy' && defaultOutlet?.delivery_mode) ? defaultOutlet.delivery_mode : undefined,
        logo_url: (mode === 'copy' && defaultOutlet?.logo_url) ? defaultOutlet.logo_url : undefined,
        banner_url: (mode === 'copy' && defaultOutlet?.banner_url) ? defaultOutlet.banner_url : undefined,
        description: (mode === 'copy' && defaultOutlet?.description) ? defaultOutlet.description : undefined,
        store_type: storeType,
        social_media_handles: Object.keys(socialHandles).length > 0 ? socialHandles : undefined,
        outlet_type: outletType,
      };

      const { data: newOutlet, error } = await supabase
        .from('vendor_outlets')
        .insert(insertPayload as any)
        .select()
        .single();

      if (error) throw error;

      // If copying, duplicate products/menu (only for same type - restaurant copies food, pharmacy would need different logic)
      if (mode === 'copy' && defaultOutlet && newOutlet && outletType === 'restaurant') {
        const { data: products } = await supabase
          .from('products')
          .select('*')
          .eq('vendor_id', vendorId)
          .eq('outlet_id', defaultOutlet.id);

        if (products && products.length > 0) {
          const newProducts = products.map(({ id, created_at, updated_at, ...rest }) => ({
            ...rest,
            outlet_id: newOutlet.id,
          }));
          await supabase.from('products').insert(newProducts);
        }
      }

      toast({ title: 'Outlet created! Pending admin approval.' });
      await refreshOutlets();
      onOpenChange(false);
      setStep('type');
    } catch (error: any) {
      toast({ title: 'Error creating outlet', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const resetDialog = () => {
    setStep('type');
    setOutletType('restaurant');
    setMode('scratch');
    setFormData({ outlet_name: '', outlet_surname: '', address: '', city: '', state: '' });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetDialog(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'type' && 'What type of outlet?'}
            {step === 'choose' && `Add ${outletType === 'pharmacy' ? 'Pharmacy' : 'Restaurant'} Outlet`}
            {step === 'form' && (mode === 'copy' ? 'Copy Main Outlet' : `New ${outletType === 'pharmacy' ? 'Pharmacy' : 'Restaurant'}`)}
          </DialogTitle>
        </DialogHeader>

        {step === 'type' ? (
          <div className="space-y-3 py-2">
            <button
              onClick={() => handleTypeSelect('restaurant')}
              className="w-full p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left space-y-1"
            >
              <div className="flex items-center gap-2 font-semibold">
                <UtensilsCrossed className="w-5 h-5 text-primary" />
                Restaurant / Food
              </div>
              <p className="text-sm text-muted-foreground">
                Add a new food outlet — restaurant, kitchen, bakery, etc.
              </p>
            </button>
            <button
              onClick={() => handleTypeSelect('pharmacy')}
              className="w-full p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left space-y-1"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Pill className="w-5 h-5 text-green-600" />
                Pharmacy / Drugstore
              </div>
              <p className="text-sm text-muted-foreground">
                Add a pharmacy outlet to sell medicines and health products.
              </p>
            </button>
          </div>
        ) : step === 'choose' ? (
          <div className="space-y-3 py-2">
            {outletType === 'restaurant' && (
              <button
                onClick={() => handleChoose('copy')}
                className="w-full p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left space-y-1"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <Copy className="w-5 h-5 text-primary" />
                  Copy Main Outlet Data
                </div>
                <p className="text-sm text-muted-foreground">
                  Duplicate your main outlet's menu, settings, and configuration to a new branch.
                </p>
              </button>
            )}
            <button
              onClick={() => handleChoose('scratch')}
              className="w-full p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left space-y-1"
            >
              <div className="flex items-center gap-2 font-semibold">
                <FileText className="w-5 h-5 text-primary" />
                Create from Scratch
              </div>
              <p className="text-sm text-muted-foreground">
                {outletType === 'pharmacy'
                  ? 'Start a fresh pharmacy outlet and add medicines from the drug database.'
                  : 'Start with a blank outlet and configure everything fresh.'}
              </p>
            </button>
            <Button variant="ghost" size="sm" onClick={() => setStep('type')} className="w-full mt-1">
              ← Change outlet type
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Outlet Name *</Label>
              <Input
                value={formData.outlet_name}
                onChange={e => setFormData({ ...formData, outlet_name: e.target.value })}
                placeholder={outletType === 'pharmacy' ? 'e.g. HealthPlus Pharmacy' : 'e.g. Main Branch'}
              />
            </div>
            <div className="space-y-2">
              <Label>Branch Tag (Surname)</Label>
              <Input
                value={formData.outlet_surname}
                onChange={e => setFormData({ ...formData, outlet_surname: e.target.value })}
                placeholder="e.g. Ikeja, Yaba, Lekki"
              />
              <p className="text-xs text-muted-foreground">
                This appears after your vendor name: "YourBrand – {formData.outlet_surname || 'Branch'}"
              </p>
            </div>
            <StoreTypeField
              storeType={storeType}
              onStoreTypeChange={setStoreType}
              socialHandles={socialHandles}
              onSocialHandlesChange={setSocialHandles}
              compact
            />
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Address *</Label>
              <Input
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                placeholder="Street address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>City *</Label>
                <Input
                  value={formData.city}
                  onChange={e => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>State *</Label>
                <Input
                  value={formData.state}
                  onChange={e => setFormData({ ...formData, state: e.target.value })}
                />
              </div>
            </div>
            {storeType === 'online' && (
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg">
                📍 A physical address is required for all vendors for verification and safety purposes.
              </p>
            )}
            {outletType === 'pharmacy' && (
              <p className="text-xs text-muted-foreground bg-green-50 dark:bg-green-950/30 p-3 rounded-lg border border-green-200 dark:border-green-900">
                💊 This pharmacy outlet will have access to the drug database. You can add medicines after approval.
              </p>
            )}
            <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
              ⏳ New outlets require admin approval before they can accept orders or be visible to customers.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('choose')} className="flex-1">
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={saving} className="flex-1 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Outlet
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
