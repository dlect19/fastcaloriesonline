import { useMemo, useState } from 'react';
import { MapPin, ExternalLink, Copy, Map, Check, Globe, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

interface MapOptionsMenuProps {
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'icon';
  label?: string;
  className?: string;
}

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
  const [copied, setCopied] = useState<null | 'full' | 'google' | 'osm' | 'bing' | 'coords'>(null);

  const hasCoords = latitude != null && longitude != null;

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

    // Bing tends to be less restricted in some environments.
    const bing = hasCoords
      ? `https://www.bing.com/maps?cp=${latitude}~${longitude}&lvl=16`
      : `https://www.bing.com/maps?q=${encodedAddress}`;

    // HERE WeGo as another fallback.
    const here = hasCoords
      ? `https://wego.here.com/?map=${latitude},${longitude},16,normal&msg=${encodedAddress}`
      : `https://wego.here.com/search/${encodedAddress}`;

    // Mobile-native maps deep link (works best on phones). Avoid if we don't have coords.
    const geo = hasCoords ? `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedAddress})` : null;

    return {
      googleMapsUrl: google,
      osmUrl: osm,
      bingMapsUrl: bing,
      hereWeGoUrl: here,
      geoUrl: geo,
    };
  }, [address, hasCoords, latitude, longitude]);

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
        // full
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <ExternalLink className="w-3 h-3 mr-1" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <a 
            href={osmUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 cursor-pointer"
          >
            <Map className="w-4 h-4" />
            Open in OpenStreetMap
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a 
            href={bingMapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 cursor-pointer"
          >
            <Globe className="w-4 h-4" />
            Open in Bing Maps
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a 
            href={googleMapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 cursor-pointer"
          >
            <MapPin className="w-4 h-4" />
            Open in Google Maps
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a 
            href={hereWeGoUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 cursor-pointer"
          >
            <Map className="w-4 h-4" />
            Open in HERE WeGo
          </a>
        </DropdownMenuItem>
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
        <DropdownMenuItem onClick={() => handleCopy('google')} className="flex items-center gap-2 cursor-pointer">
          {copied === 'google' ? <Check className="w-4 h-4 text-calorie-low" /> : <Copy className="w-4 h-4" />}
          Copy Google Maps link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleCopy('osm')} className="flex items-center gap-2 cursor-pointer">
          {copied === 'osm' ? <Check className="w-4 h-4 text-calorie-low" /> : <Copy className="w-4 h-4" />}
          Copy OpenStreetMap link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleCopy('bing')} className="flex items-center gap-2 cursor-pointer">
          {copied === 'bing' ? <Check className="w-4 h-4 text-calorie-low" /> : <Copy className="w-4 h-4" />}
          Copy Bing Maps link
        </DropdownMenuItem>
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
