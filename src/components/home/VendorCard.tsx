import { useNavigate } from 'react-router-dom';
import { Star, Clock, Bike } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VendorCardProps {
  id: string;
  name: string;
  category: string;
  imageUrl?: string;
  rating: number;
  deliveryTime: number;
  deliveryFee: number;
  isOpen?: boolean;
  onClick?: () => void;
}

export function VendorCard({
  id,
  name,
  category,
  imageUrl,
  rating,
  deliveryTime,
  deliveryFee,
  isOpen = true,
}: VendorCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/vendor/${id}`);
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left bg-card rounded-2xl overflow-hidden shadow-soft border border-border hover:shadow-card transition-all group"
    >
      {/* Image */}
      <div className="relative h-32 bg-secondary overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <span className="text-4xl">🍽️</span>
          </div>
        )}

        {/* Status badge */}
        <div
          className={cn(
            'absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-medium',
            isOpen
              ? 'bg-calorie-low/90 text-white'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {isOpen ? 'Open' : 'Closed'}
        </div>

        {/* Rating badge */}
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-card/95 backdrop-blur-sm px-2 py-1 rounded-full">
          <Star className="w-3.5 h-3.5 fill-warning text-warning" />
          <span className="text-xs font-semibold text-foreground">{rating.toFixed(1)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-foreground mb-1 truncate">{name}</h3>
        <p className="text-sm text-muted-foreground mb-3">{category}</p>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>{deliveryTime} min</span>
          </div>
          <div className="flex items-center gap-1">
            <Bike className="w-4 h-4" />
            <span>₦{deliveryFee.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </button>
  );
}
