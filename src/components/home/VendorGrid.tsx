import { VendorCard } from './VendorCard';

// Mock data for demo
const mockVendors = [
  {
    id: '1',
    name: 'Green Bowl Kitchen',
    category: 'Healthy • Salads • Bowls',
    rating: 4.8,
    deliveryTime: 25,
    deliveryFee: 500,
    isOpen: true,
  },
  {
    id: '2',
    name: 'Mama Nkechi\'s Place',
    category: 'Nigerian • Local • Rice',
    rating: 4.6,
    deliveryTime: 35,
    deliveryFee: 400,
    isOpen: true,
  },
  {
    id: '3',
    name: 'Fit Meals Lagos',
    category: 'Protein • Low Carb • Keto',
    rating: 4.9,
    deliveryTime: 30,
    deliveryFee: 600,
    isOpen: true,
  },
  {
    id: '4',
    name: 'HealthPlus Pharmacy',
    category: 'Pharmacy • Vitamins • First Aid',
    rating: 4.7,
    deliveryTime: 20,
    deliveryFee: 300,
    isOpen: true,
  },
  {
    id: '5',
    name: 'Fresh Market Express',
    category: 'Groceries • Fruits • Vegetables',
    rating: 4.5,
    deliveryTime: 40,
    deliveryFee: 350,
    isOpen: false,
  },
  {
    id: '6',
    name: 'Protein Hub',
    category: 'Grills • Protein • Healthy',
    rating: 4.4,
    deliveryTime: 28,
    deliveryFee: 450,
    isOpen: true,
  },
];

interface VendorGridProps {
  title?: string;
  category?: string;
}

export function VendorGrid({ title = 'Nearby Vendors', category = 'all' }: VendorGridProps) {
  const filteredVendors = category === 'all' 
    ? mockVendors 
    : mockVendors.filter(v => {
        if (category === 'restaurant') return !v.category.includes('Pharmacy') && !v.category.includes('Groceries');
        if (category === 'pharmacy') return v.category.includes('Pharmacy');
        if (category === 'market') return v.category.includes('Groceries');
        return true;
      });

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <button className="text-sm font-medium text-primary hover:underline">
          See all
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredVendors.map((vendor) => (
          <VendorCard
            key={vendor.id}
            {...vendor}
            onClick={() => console.log('Navigate to vendor:', vendor.id)}
          />
        ))}
      </div>
    </section>
  );
}
