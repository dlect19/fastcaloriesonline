import { ReactNode, useCallback } from 'react';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { OutletProvider, useOutletContext } from '@/hooks/useOutletContext';
import { VendorPermission } from '@/hooks/useVendorPermissions';

interface VendorLayoutProps {
  children: ReactNode;
  vendorName?: string;
  vendorId?: string;
  permissions?: VendorPermission[];
  onOutletChange?: (outletId: string | null) => void;
}

interface VendorLayoutContentProps extends VendorLayoutProps {}

function VendorLayoutContent({ children, vendorName, vendorId, permissions, onOutletChange }: VendorLayoutContentProps) {
  const { setSelectedOutletId } = useOutletContext();

  const handleOutletChange = useCallback((outletId: string | null) => {
    if (outletId) {
      setSelectedOutletId(outletId);
    }
    onOutletChange?.(outletId);
  }, [onOutletChange, setSelectedOutletId]);

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar
        vendorName={vendorName}
        vendorId={vendorId}
        permissions={permissions}
        onOutletChange={handleOutletChange}
      />
      <main className="lg:ml-64 pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}

export function VendorLayout({ children, vendorName, vendorId, permissions, onOutletChange }: VendorLayoutProps) {
  return (
    <OutletProvider vendorId={vendorId || null} onOutletChange={onOutletChange}>
      <VendorLayoutContent
        vendorName={vendorName}
        vendorId={vendorId}
        permissions={permissions}
        onOutletChange={onOutletChange}
      >
        {children}
      </VendorLayoutContent>
    </OutletProvider>
  );
}

