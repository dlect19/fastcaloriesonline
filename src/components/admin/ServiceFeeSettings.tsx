import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DollarSign, Save, Loader2, Truck, Store, Pill, ShoppingBasket, MessageCircle } from 'lucide-react';

interface ServiceFeeSettingsProps {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
}

function FeeConfigSection({
  settings,
  onSettingChange,
  suffix = '',
  defaultFixed = '100',
  defaultPercentage = '5',
  defaultMin = '100',
  defaultMax = '1000',
}: {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  suffix?: string;
  defaultFixed?: string;
  defaultPercentage?: string;
  defaultMin?: string;
  defaultMax?: string;
}) {
  const feeType = settings[`service_fee_type${suffix}`] || 'fixed';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Service Fee Type</Label>
        <Select value={feeType} onValueChange={(v) => onSettingChange(`service_fee_type${suffix}`, v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed Amount</SelectItem>
            <SelectItem value="percentage">Percentage</SelectItem>
            <SelectItem value="hybrid">Hybrid (% with Min/Max)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(feeType === 'fixed' || feeType === 'hybrid') && (
        <div className="space-y-2">
          <Label>{feeType === 'fixed' ? 'Fixed Service Fee' : 'Minimum Fee'}</Label>
          <div className="relative">
            <Input
              type="number"
              min="0"
              step="50"
              value={feeType === 'fixed' ? (settings[`service_fee_fixed${suffix}`] || defaultFixed) : (settings[`service_fee_min${suffix}`] || defaultMin)}
              onChange={(e) => onSettingChange(feeType === 'fixed' ? `service_fee_fixed${suffix}` : `service_fee_min${suffix}`, e.target.value)}
              className="pl-8"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
          </div>
        </div>
      )}

      {(feeType === 'percentage' || feeType === 'hybrid') && (
        <div className="space-y-2">
          <Label>Service Fee Percentage</Label>
          <div className="relative">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={settings[`service_fee_percentage${suffix}`] || defaultPercentage}
              onChange={(e) => onSettingChange(`service_fee_percentage${suffix}`, e.target.value)}
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
        </div>
      )}

      {feeType === 'hybrid' && (
        <div className="space-y-2">
          <Label>Maximum Fee (Cap)</Label>
          <div className="relative">
            <Input
              type="number"
              min="0"
              step="50"
              value={settings[`service_fee_max${suffix}`] || defaultMax}
              onChange={(e) => onSettingChange(`service_fee_max${suffix}`, e.target.value)}
              className="pl-8"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
          </div>
        </div>
      )}

      <div className="p-4 bg-secondary rounded-lg">
        <h4 className="text-sm font-medium text-foreground mb-2">Service Fee Formula</h4>
        {feeType === 'fixed' && (
          <p className="text-sm text-muted-foreground">
            Every order: <span className="text-primary font-medium">₦{parseInt(settings[`service_fee_fixed${suffix}`] || defaultFixed).toLocaleString()}</span>
          </p>
        )}
        {feeType === 'percentage' && (
          <p className="text-sm text-muted-foreground">
            <span className="text-primary font-medium">{settings[`service_fee_percentage${suffix}`] || defaultPercentage}%</span> of order subtotal
          </p>
        )}
        {feeType === 'hybrid' && (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="text-primary font-medium">{settings[`service_fee_percentage${suffix}`] || defaultPercentage}%</span> of order subtotal
            </p>
            <p className="text-sm text-muted-foreground">
              Min: <span className="text-primary font-medium">₦{parseInt(settings[`service_fee_min${suffix}`] || defaultMin).toLocaleString()}</span> |
              Max: <span className="text-primary font-medium">₦{parseInt(settings[`service_fee_max${suffix}`] || defaultMax).toLocaleString()}</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function ServiceFeeSettings({ settings, onSettingChange, onSave, saving }: ServiceFeeSettingsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-primary" />
          Service Fee Configuration
        </CardTitle>
        <CardDescription>
          Independent service fees per order type. Food uses Delivery/Carryout; Pharmacy and Grocery/Marketplace each have their own settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="delivery" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="delivery" className="flex items-center gap-1.5 text-xs md:text-sm">
              <Truck className="w-4 h-4" /> Food · Delivery
            </TabsTrigger>
            <TabsTrigger value="pickup" className="flex items-center gap-1.5 text-xs md:text-sm">
              <Store className="w-4 h-4" /> Food · Carryout
            </TabsTrigger>
            <TabsTrigger value="pharmacy" className="flex items-center gap-1.5 text-xs md:text-sm">
              <Pill className="w-4 h-4" /> Pharmacy
            </TabsTrigger>
            <TabsTrigger value="grocery" className="flex items-center gap-1.5 text-xs md:text-sm">
              <ShoppingBasket className="w-4 h-4" /> Grocery
            </TabsTrigger>
          </TabsList>
          <TabsContent value="delivery" className="mt-4">
            <FeeConfigSection
              settings={settings} onSettingChange={onSettingChange}
              suffix="" defaultFixed="100" defaultPercentage="5" defaultMin="100" defaultMax="1000"
            />
          </TabsContent>
          <TabsContent value="pickup" className="mt-4">
            <FeeConfigSection
              settings={settings} onSettingChange={onSettingChange}
              suffix="_pickup" defaultFixed="50" defaultPercentage="3" defaultMin="50" defaultMax="500"
            />
          </TabsContent>
          <TabsContent value="pharmacy" className="mt-4">
            <p className="text-xs text-muted-foreground mb-3">Applies to orders from pharmacy vendors (any delivery type).</p>
            <FeeConfigSection
              settings={settings} onSettingChange={onSettingChange}
              suffix="_pharmacy" defaultFixed="100" defaultPercentage="15" defaultMin="100" defaultMax="5000"
            />
          </TabsContent>
          <TabsContent value="grocery" className="mt-4">
            <p className="text-xs text-muted-foreground mb-3">Applies to orders from grocery/marketplace vendors (any delivery type).</p>
            <FeeConfigSection
              settings={settings} onSettingChange={onSettingChange}
              suffix="_grocery" defaultFixed="100" defaultPercentage="15" defaultMin="100" defaultMax="7500"
            />
          </TabsContent>
        </Tabs>

        {/* Twilio pass-through toggle */}
        <div className="flex items-start justify-between gap-4 p-4 border border-border rounded-lg">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <MessageCircle className="w-4 h-4 text-primary" />
              Add Twilio message cost to service charge
            </Label>
            <p className="text-xs text-muted-foreground">
              When ON, the cost of WhatsApp/SMS messages sent on behalf of an order (tracked in Twilio Costs) is added to that order's service charge.
            </p>
          </div>
          <Switch
            checked={(settings.service_fee_include_twilio || 'false') === 'true'}
            onCheckedChange={(v) => onSettingChange('service_fee_include_twilio', v ? 'true' : 'false')}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
