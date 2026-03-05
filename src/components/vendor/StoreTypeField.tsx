import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Smartphone } from 'lucide-react';

export type StoreType = 'physical' | 'online' | 'both';

export interface SocialMediaHandles {
  instagram?: string;
  tiktok?: string;
  x?: string;
  facebook?: string;
  whatsapp?: string;
  youtube?: string;
}

const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', placeholder: '@yourhandle', icon: '📸' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@yourhandle', icon: '🎵' },
  { key: 'x', label: 'X (Twitter)', placeholder: '@yourhandle', icon: '𝕏' },
  { key: 'facebook', label: 'Facebook', placeholder: 'Page name or URL', icon: '📘' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: '08012345678', icon: '💬' },
  { key: 'youtube', label: 'YouTube', placeholder: '@channel or URL', icon: '▶️' },
] as const;

interface StoreTypeFieldProps {
  storeType: StoreType;
  onStoreTypeChange: (type: StoreType) => void;
  socialHandles: SocialMediaHandles;
  onSocialHandlesChange: (handles: SocialMediaHandles) => void;
  compact?: boolean;
}

export function StoreTypeField({
  storeType,
  onStoreTypeChange,
  socialHandles,
  onSocialHandlesChange,
  compact = false,
}: StoreTypeFieldProps) {
  const showSocial = storeType === 'online' || storeType === 'both';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          {storeType === 'online' ? <Smartphone className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
          Store Type
        </Label>
        <Select value={storeType} onValueChange={(v) => onStoreTypeChange(v as StoreType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="physical">Physical Store</SelectItem>
            <SelectItem value="online">Online (Social Media)</SelectItem>
            <SelectItem value="both">Both Physical & Online</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {storeType === 'physical' && 'Your business has a physical location customers can visit.'}
          {storeType === 'online' && 'You sell through social media platforms.'}
          {storeType === 'both' && 'You have a physical location and also sell online.'}
        </p>
      </div>

      {showSocial && (
        <div className="space-y-3 p-4 rounded-xl bg-muted/50 border border-border">
          <p className="text-sm font-medium text-foreground">Social Media Handles</p>
          <p className="text-xs text-muted-foreground mb-2">Add your social media profiles so customers can find you.</p>
          <div className={compact ? 'space-y-3' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
            {SOCIAL_PLATFORMS.map(({ key, label, placeholder, icon }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs flex items-center gap-1.5">
                  <span>{icon}</span> {label}
                </Label>
                <Input
                  placeholder={placeholder}
                  value={(socialHandles as any)[key] || ''}
                  onChange={(e) =>
                    onSocialHandlesChange({ ...socialHandles, [key]: e.target.value || undefined })
                  }
                  className="h-9 text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small badge icons for VendorCard display */
export function SocialMediaBadges({ handles }: { handles?: SocialMediaHandles | null }) {
  if (!handles || typeof handles !== 'object') return null;

  const active = SOCIAL_PLATFORMS.filter(p => (handles as any)[p.key]);
  if (active.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {active.map(({ key, icon, label }) => (
        <span
          key={key}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary text-sm leading-none"
          title={`${label}: ${(handles as any)[key]}`}
        >
          {icon}
        </span>
      ))}
    </div>
  );
}
