import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Search, ShoppingBag, Heart, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { id: 'home', icon: Home, label: 'Home', path: '/' },
  { id: 'search', icon: Search, label: 'Explore', path: '/explore' },
  { id: 'orders', icon: ShoppingBag, label: 'Orders', path: '/orders' },
  { id: 'favorites', icon: Heart, label: 'Favorites', path: '/favorites' },
  { id: 'profile', icon: User, label: 'Profile', path: '/profile' },
];

interface BottomNavProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavClick = (item: typeof navItems[0]) => {
    onTabChange?.(item.id);
    navigate(item.path);
  };

  // Determine active tab based on current path if not provided
  const currentTab = activeTab || navItems.find(item => item.path === location.pathname)?.id || 'home';

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border safe-bottom z-50">
      <div className="container flex items-center justify-around py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item)}
              className={cn(
                'flex flex-col items-center gap-1 py-2 px-4 rounded-xl transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-all',
                  isActive && 'scale-110'
                )}
                fill={isActive ? 'currentColor' : 'none'}
              />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
