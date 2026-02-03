import { useMemo, useState } from 'react';
import { MapPin, ExternalLink, Copy, Map, Check, Globe, Smartphone, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

interface MapOptionsMenuProps {
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'icon';
  label?: string;
  className?: string;
}

type MapProvider = 'google' | 'osm' | 'bing' | 'here';

const MAP_PROVIDER_LABELS: Record<MapProvider, string> = {
  google: 'Google Maps',
  osm: 'OpenStreetMap',
  bing: 'Bing Maps',
  here: 'HERE WeGo',
};

const MAP_PROVIDER_ICONS: Record<MapProvider, typeof MapPin> = {
  google: MapPin,
  osm: Map,
  bing: Globe,
  here: Map,
};

export function MapOptionsMenu({ 
  address, 
  latitude, 
  longitude, 
  variant = 'ghost',
  size = 'sm',
  label = 'Map',
  className
}: MapOptionsMenuProps) {
  const { toast } = useToast();
  const { settings } = usePlatformSettings();
  const [copied, setCopied] = useState<null | 'full' | 'google' | 'osm' | 'bing' | 'coords'>(null);

  const hasCoords = latitude != null && longitude != null;

  // Get the admin-configured default navigation app - validate it's a known provider
  const configuredProvider = settings.default_navigation_app as string;
  const validProviders: MapProvider[] = ['google', 'osm', 'bing', 'here'];
  const defaultProvider: MapProvider = validProviders.includes(configuredProvider as MapProvider) 
    ? (configuredProvider as MapProvider) 
    : 'google';

  const {
    googleMapsUrl,
    osmUrl,
    bingMapsUrl,
    hereWeGoUrl,
    geoUrl,
  } = useMemo(() => {
    const encodedAddress = encodeURIComponent(address);
    const coords = hasCoords ? `${latitude},${longitude}` : null;

    const google = hasCoords
      ? `https://www.google.com/maps/search/?api=1&query=${coords}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

    const osm = hasCoords
      ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=16`
      : `https://www.openstreetmap.org/search?query=${encodedAddress}`;

    const bing = hasCoords
      ? `https://www.bing.com/maps?cp=${latitude}~${longitude}&lvl=16`
      : `https://www.bing.com/maps?q=${encodedAddress}`;

    const here = hasCoords
      ? `https://wego.here.com/?map=${latitude},${longitude},16,normal&msg=${encodedAddress}`
      : `https://wego.here.com/search/${encodedAddress}`;

    const geo = hasCoords ? `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedAddress})` : null;

    return {
      googleMapsUrl: google,
      osmUrl: osm,
      bingMapsUrl: bing,
      hereWeGoUrl: here,
      geoUrl: geo,
    };
  }, [address, hasCoords, latitude, longitude]);

  const getUrlForProvider = (provider: MapProvider): string => {
    switch (provider) {
      case 'google': return googleMapsUrl;
      case 'osm': return osmUrl;
      case 'bing': return bingMapsUrl;
      case 'here': return hereWeGoUrl;
    }
  };

  const handleCopy = async (mode: NonNullable<typeof copied>) => {
    try {
      let textToCopy = '';

      if (mode === 'google') textToCopy = googleMapsUrl;
      else if (mode === 'osm') textToCopy = osmUrl;
      else if (mode === 'bing') textToCopy = bingMapsUrl;
      else if (mode === 'coords') {
        if (!hasCoords) throw new Error('No coordinates');
        textToCopy = `${latitude}, ${longitude}`;
      } else {
        textToCopy = hasCoords
          ? `${address}\n${latitude}, ${longitude}\n${bingMapsUrl}\n${googleMapsUrl}\n${osmUrl}`
          : `${address}\n${bingMapsUrl}\n${googleMapsUrl}\n${osmUrl}`;
      }

      await navigator.clipboard.writeText(textToCopy);
      setCopied(mode);
      toast({ title: 'Copied' });
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    }
  };

  const DefaultIcon = MAP_PROVIDER_ICONS[defaultProvider];
  const otherProviders = (['google', 'osm', 'bing', 'here'] as MapProvider[]).filter(p => p !== defaultProvider);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <ExternalLink className="w-3 h-3 mr-1" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {/* Primary Option - Admin Configured */}
        <DropdownMenuItem asChild>
          <a 
            href={getUrlForProvider(defaultProvider)} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 cursor-pointer font-medium"
          >
            <DefaultIcon className="w-4 h-4" />
            Open in {MAP_PROVIDER_LABELS[defaultProvider]}
          </a>
        </DropdownMenuItem>

        {/* Mobile native maps option */}
        {geoUrl && (
          <DropdownMenuItem asChild>
            <a 
              href={geoUrl} 
              className="flex items-center gap-2 cursor-pointer"
            >
              <Smartphone className="w-4 h-4" />
              Open in Maps app
            </a>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Other Map Apps Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2">
            <Map className="w-4 h-4" />
            Other map apps
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {otherProviders.map(provider => {
              const Icon = MAP_PROVIDER_ICONS[provider];
              return (
                <DropdownMenuItem key={provider} asChild>
                  <a 
                    href={getUrlForProvider(provider)} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Icon className="w-4 h-4" />
                    {MAP_PROVIDER_LABELS[provider]}
                  </a>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Copy Options */}
        {hasCoords && (
          <DropdownMenuItem onClick={() => handleCopy('coords')} className="flex items-center gap-2 cursor-pointer">
            {copied === 'coords' ? <Check className="w-4 h-4 text-calorie-low" /> : <Copy className="w-4 h-4" />}
            Copy coordinates
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => handleCopy('full')} className="flex items-center gap-2 cursor-pointer">
          {copied === 'full' ? (
            <>
              <Check className="w-4 h-4 text-calorie-low" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy address & links
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
