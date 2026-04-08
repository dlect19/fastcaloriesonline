import { useState } from 'react';
import { Bell, MapPin, Search, Camera, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { CameraActionSheet } from './CameraActionSheet';

interface HeaderProps {
  userName?: string;
  address?: string;
  onSearch?: (query: string) => void;
  onLocationClick?: () => void;
}

export function Header({ userName = 'Guest', address = 'Set your location', onSearch, onLocationClick }: HeaderProps) {
  const navigate = useNavigate();
  const [showCameraSheet, setShowCameraSheet] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    onSearch?.(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearchSubmit(e);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border safe-top">
        <div className="container py-4">
          {/* Top row: Location & Notifications */}
          <div className="flex items-center justify-between mb-4">
            <button className="flex items-center gap-2 text-left" onClick={onLocationClick}>
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Deliver to</p>
                <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                  {address}
                </p>
              </div>
            </button>

            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
            </Button>
          </div>

          {/* Search bar with Camera & Favorites */}
          <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleKeyDown}
                placeholder="Search restaurants, dishes, groceries..."
                className="w-full h-12 pl-12 pr-4 bg-secondary rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setShowCameraSheet(true)}
              className="h-12 w-12 rounded-xl shrink-0"
            >
              <Camera className="w-5 h-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => navigate('/favorites')}
              className="h-12 w-12 rounded-xl shrink-0"
            >
              <Heart className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </header>

      <CameraActionSheet open={showCameraSheet} onOpenChange={setShowCameraSheet} />
    </>
  );
}
