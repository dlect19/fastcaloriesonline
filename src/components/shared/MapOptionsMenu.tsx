import { useState } from 'react';
import { MapPin, ExternalLink, Copy, Map, Check } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);

  const query = latitude && longitude 
    ? `${latitude},${longitude}` 
    : encodeURIComponent(address);

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
  const osmUrl = latitude && longitude
    ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=16`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

  const handleCopy = async () => {
    try {
      const textToCopy = latitude && longitude 
        ? `${address}\n\nCoordinates: ${latitude}, ${longitude}\n\nGoogle Maps: ${googleMapsUrl}\nOpenStreetMap: ${osmUrl}`
        : `${address}\n\nGoogle Maps: ${googleMapsUrl}`;
      
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast({ title: 'Address copied to clipboard' });
      setTimeout(() => setCopied(false), 2000);
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
            href={googleMapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 cursor-pointer"
          >
            <MapPin className="w-4 h-4" />
            Open in Google Maps
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopy} className="flex items-center gap-2 cursor-pointer">
          {copied ? (
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
