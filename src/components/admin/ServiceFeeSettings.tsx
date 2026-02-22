import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Save, Loader2 } from 'lucide-react';

interface ServiceFeeSettingsProps {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function ServiceFeeSettings({ settings, onSettingChange, onSave, saving }: ServiceFeeSettingsProps) {
  const feeType = settings['service_fee_type'] || 'fixed';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-primary" />
          Service Fee Configuration
        </CardTitle>
        <CardDescription>
          Configure how service fees are calculated for customer orders
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Service Fee Type</Label>
          <Select value={feeType} onValueChange={(v) => onSettingChange('service_fee_type', v)}>
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
                value={feeType === 'fixed' ? (settings['service_fee_fixed'] || '100') : (settings['service_fee_min'] || '100')}
                onChange={(e) => onSettingChange(feeType === 'fixed' ? 'service_fee_fixed' : 'service_fee_min', e.target.value)}
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
                value={settings['service_fee_percentage'] || '5'}
                onChange={(e) => onSettingChange('service_fee_percentage', e.target.value)}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        )}

        {feeType === 'hybrid' && (
          <div className="space-y-2">
            <Label>Maximum Fee</Label>
            <div className="relative">
              <Input
                type="number"
                min="0"
                step="50"
                value={settings['service_fee_max'] || '1000'}
                onChange={(e) => onSettingChange('service_fee_max', e.target.value)}
                className="pl-8"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
            </div>
          </div>
        )}

        {/* Formula Preview */}
        <div className="p-4 bg-secondary rounded-lg">
          <h4 className="text-sm font-medium text-foreground mb-2">Service Fee Formula</h4>
          {feeType === 'fixed' && (
            <p className="text-sm text-muted-foreground">
              Every order: <span className="text-primary font-medium">₦{parseInt(settings['service_fee_fixed'] || '100').toLocaleString()}</span>
            </p>
          )}
          {feeType === 'percentage' && (
            <p className="text-sm text-muted-foreground">
              <span className="text-primary font-medium">{settings['service_fee_percentage'] || '5'}%</span> of order subtotal
            </p>
          )}
          {feeType === 'hybrid' && (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="text-primary font-medium">{settings['service_fee_percentage'] || '5'}%</span> of order subtotal
              </p>
              <p className="text-sm text-muted-foreground">
                Min: <span className="text-primary font-medium">₦{parseInt(settings['service_fee_min'] || '100').toLocaleString()}</span> | 
                Max: <span className="text-primary font-medium">₦{parseInt(settings['service_fee_max'] || '1000').toLocaleString()}</span>
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Formula: min(max(Subtotal × {settings['service_fee_percentage'] || '5'}%, ₦{settings['service_fee_min'] || '100'}), ₦{settings['service_fee_max'] || '1000'})
              </p>
            </>
          )}
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
