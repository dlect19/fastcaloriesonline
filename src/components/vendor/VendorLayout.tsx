import { ReactNode } from 'react';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { OutletProvider } from '@/hooks/useOutletContext';
import { VendorPermission } from '@/hooks/useVendorPermissions';

interface VendorLayoutProps {
  children: ReactNode;
  vendorName?: string;
  vendorId?: string;
  permissions?: VendorPermission[];
  onOutletChange?: (outletId: string | null) => void;
}

export function VendorLayout({ children, vendorName, vendorId, permissions, onOutletChange }: VendorLayoutProps) {
  return (
    <OutletProvider vendorId={vendorId || null} onOutletChange={onOutletChange}>
      <div className="min-h-screen bg-background">
        <VendorSidebar vendorName={vendorName} vendorId={vendorId} permissions={permissions} onOutletChange={onOutletChange} />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          {children}
        </main>
      </div>
    </OutletProvider>
  );
}
