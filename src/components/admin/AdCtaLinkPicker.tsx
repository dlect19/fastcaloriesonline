import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Search } from 'lucide-react';

/**
 * Reusable CTA + Link picker for admin/vendor ad forms.
 *
 * - CTA label: preset ("Learn More", "Chat Now", "Buy Now", "Order Now",
 *   "Register Now", "Book Now", "Shop Now", "View Now") or Custom text.
 * - Link URL: quick internal presets (Explore, Pharmacy, Marketplace,
 *   Restaurants, Events, Free Meals, Rewards, Cart), a specific vendor
 *   search, or a custom URL / internal path.
 */

export const CTA_PRESETS = [
  'Learn More',
  'Order Now',
  'Shop Now',
  'Buy Now',
  'Chat Now',
  'Register Now',
  'Book Now',
  'View Now',
] as const;

const INTERNAL_PRESETS: { label: string; path: string }[] = [
  { label: 'Home', path: '/' },
  { label: 'Explore (All)', path: '/explore' },
  { label: 'Restaurants', path: '/explore?category=restaurant' },
  { label: 'Marketplace / Groceries', path: '/explore?category=grocery' },
  { label: 'Pharmacy', path: '/explore?category=pharmacy' },
  { label: 'Events', path: '/events' },
  { label: 'Free Meals', path: '/free-meals' },
  { label: 'Rewards', path: '/rewards' },
  { label: 'Cart', path: '/cart' },
];

type LinkMode = 'none' | 'internal' | 'vendor' | 'custom';

interface Props {
  ctaLabel: string;                       // stored value
  onCtaLabelChange: (v: string) => void;
  linkUrl: string;                        // stored value
  onLinkUrlChange: (v: string) => void;
}

export function AdCtaLinkPicker({ ctaLabel, onCtaLabelChange, linkUrl, onLinkUrlChange }: Props) {
  // ---- CTA label state ----
  const isPreset = (CTA_PRESETS as readonly string[]).includes(ctaLabel);
  const [ctaMode, setCtaMode] = useState<'preset' | 'custom'>(
    !ctaLabel || isPreset ? 'preset' : 'custom'
  );

  // ---- Link mode state (inferred from current value) ----
  const inferredMode: LinkMode = useMemo(() => {
    if (!linkUrl) return 'none';
    if (linkUrl.startsWith('/vendor/')) return 'vendor';
    if (linkUrl.startsWith('/')) {
      const match = INTERNAL_PRESETS.some(p => p.path === linkUrl);
      return match ? 'internal' : 'custom';
    }
    return 'custom';
  }, [linkUrl]);

  const [linkMode, setLinkMode] = useState<LinkMode>(inferredMode);
  useEffect(() => { setLinkMode(inferredMode); }, [inferredMode]);

  // ---- Vendor search ----
  const [vendorQuery, setVendorQuery] = useState('');
  const [vendorResults, setVendorResults] = useState<Array<{ id: string; name: string }>>([]);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [selectedVendorName, setSelectedVendorName] = useState<string>('');

  // If we opened with a vendor url, try to resolve its name once
  useEffect(() => {
    const id = linkUrl.startsWith('/vendor/') ? linkUrl.replace('/vendor/', '').split(/[/?#]/)[0] : '';
    if (!id || selectedVendorName) return;
    supabase.from('vendors').select('id, name').eq('id', id).maybeSingle().then(({ data }) => {
      if (data?.name) setSelectedVendorName(data.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (linkMode !== 'vendor') return;
    const q = vendorQuery.trim();
    if (q.length < 2) { setVendorResults([]); return; }
    let cancel = false;
    setVendorLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('vendors')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .limit(10);
      if (!cancel) {
        setVendorResults((data as any) || []);
        setVendorLoading(false);
      }
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [vendorQuery, linkMode]);

  const handleLinkModeChange = (m: LinkMode) => {
    setLinkMode(m);
    if (m === 'none') onLinkUrlChange('');
    if (m === 'internal' && !INTERNAL_PRESETS.some(p => p.path === linkUrl)) onLinkUrlChange('/explore');
    if (m === 'vendor' && !linkUrl.startsWith('/vendor/')) onLinkUrlChange('');
    if (m === 'custom' && (linkUrl.startsWith('/vendor/') || INTERNAL_PRESETS.some(p => p.path === linkUrl))) {
      // keep whatever they had; if it was an internal preset, wipe so they type their own
      if (INTERNAL_PRESETS.some(p => p.path === linkUrl)) onLinkUrlChange('');
    }
  };

  return (
    <div className="space-y-4">
      {/* ---------- CTA Button Label ---------- */}
      <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
        <Label className="text-sm font-medium">Action Button Label</Label>
        <div className="grid grid-cols-2 gap-2">
          <Select value={ctaMode} onValueChange={(v: 'preset' | 'custom') => {
            setCtaMode(v);
            if (v === 'preset' && !isPreset) onCtaLabelChange('Learn More');
            if (v === 'custom' && isPreset) onCtaLabelChange('');
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="preset">Choose preset</SelectItem>
              <SelectItem value="custom">Custom text</SelectItem>
            </SelectContent>
          </Select>

          {ctaMode === 'preset' ? (
            <Select
              value={isPreset ? ctaLabel : 'Learn More'}
              onValueChange={onCtaLabelChange}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CTA_PRESETS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={ctaLabel}
              onChange={(e) => onCtaLabelChange(e.target.value)}
              placeholder="e.g. Get Yours Now"
              maxLength={30}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Shown as the primary button on the ad. Defaults to "Learn More" if empty.
        </p>
      </div>

      {/* ---------- Link URL ---------- */}
      <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
        <Label className="text-sm font-medium">Where does the button go?</Label>

        <Select value={linkMode} onValueChange={(v: LinkMode) => handleLinkModeChange(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No link (button hidden)</SelectItem>
            <SelectItem value="internal">Internal page (Explore, Pharmacy, etc.)</SelectItem>
            <SelectItem value="vendor">Specific vendor</SelectItem>
            <SelectItem value="custom">Custom URL / path</SelectItem>
          </SelectContent>
        </Select>

        {linkMode === 'internal' && (
          <Select
            value={INTERNAL_PRESETS.some(p => p.path === linkUrl) ? linkUrl : '/explore'}
            onValueChange={onLinkUrlChange}
          >
            <SelectTrigger><SelectValue placeholder="Select a destination" /></SelectTrigger>
            <SelectContent>
              {INTERNAL_PRESETS.map(p => (
                <SelectItem key={p.path} value={p.path}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {linkMode === 'vendor' && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={vendorQuery}
                onChange={(e) => setVendorQuery(e.target.value)}
                placeholder="Search vendor by name..."
              />
              {vendorLoading && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {vendorResults.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto bg-background">
                {vendorResults.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onLinkUrlChange(`/vendor/${v.id}`);
                      setSelectedVendorName(v.name);
                      setVendorQuery('');
                      setVendorResults([]);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            )}
            {linkUrl.startsWith('/vendor/') && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedVendorName || linkUrl}</span>
              </p>
            )}
          </div>
        )}

        {linkMode === 'custom' && (
          <>
            <Input
              value={linkUrl}
              onChange={(e) => onLinkUrlChange(e.target.value)}
              placeholder="/explore?category=restaurant or https://..."
            />
            <p className="text-xs text-muted-foreground">
              Paste any internal path (starts with <code>/</code>) or a full external URL.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
