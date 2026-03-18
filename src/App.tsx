import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { CartProvider } from "@/hooks/useCart";
import { PWAUpdateBanner } from "@/components/PWAUpdateBanner";
import { ForceUpdateOverlay } from "@/components/ForceUpdateOverlay";
import { NetworkStatusOverlay } from "@/components/NetworkStatusOverlay";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import Cart from "./pages/Cart";
import VendorDetail from "./pages/VendorDetail";
import Explore from "./pages/Explore";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Favorites from "./pages/Favorites";
import VerifyEmail from "./pages/VerifyEmail";
import VerificationPending from "./pages/VerificationPending";
import PaymentCallback from "./pages/PaymentCallback";
import VendorLanding from "./pages/VendorLanding";
import RiderLanding from "./pages/RiderLanding";
import DeliveryCompanyLanding from "./pages/DeliveryCompanyLanding";
import VendorAuth from "./pages/vendor/VendorAuth";
import VendorDashboard from "./pages/vendor/VendorDashboard";
import VendorMenu from "./pages/vendor/VendorMenu";
import VendorOrders from "./pages/vendor/VendorOrders";
import VendorReviews from "./pages/vendor/VendorReviews";
import VendorEarnings from "./pages/vendor/VendorEarnings";
import VendorWithdraw from "./pages/vendor/VendorWithdraw";
import VendorHours from "./pages/vendor/VendorHours";
import VendorSettings from "./pages/vendor/VendorSettings";
import VendorStoreSettings from "./pages/vendor/VendorStoreSettings";
import VendorPromos from "./pages/vendor/VendorPromos";
import VendorRiders from "./pages/vendor/VendorRiders";
import VendorStaff from "./pages/vendor/VendorStaff";
import VendorStaffJoin from "./pages/vendor/VendorStaffJoin";
import VendorStaffLogin from "./pages/vendor/VendorStaffLogin";
import VendorRiderJoin from "./pages/rider/VendorRiderJoin";
import RiderAuth from "./pages/rider/RiderAuth";
import RiderDashboard from "./pages/rider/RiderDashboard";
import RiderOrders from "./pages/rider/RiderOrders";
import RiderAvailableOrders from "./pages/rider/RiderAvailableOrders";
import RiderEarnings from "./pages/rider/RiderEarnings";
import RiderWithdraw from "./pages/rider/RiderWithdraw";
import RiderSettings from "./pages/rider/RiderSettings";
import AdminAuth from "./pages/admin/AdminAuth";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminVendors from "./pages/admin/AdminVendors";
import AdminVendorMenus from "./pages/admin/AdminVendorMenus";
import AdminRiders from "./pages/admin/AdminRiders";
import AdminPromos from "./pages/admin/AdminPromos";
import AdminVendorCommissionPromos from "./pages/admin/AdminVendorCommissionPromos";
import AdminRewards from "./pages/admin/AdminRewards";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminStaff from "./pages/admin/AdminStaff";
import AdminStaffJoin from "./pages/admin/AdminStaffJoin";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminAdvertisements from "./pages/admin/AdminAdvertisements";
import AdminCampaigns from "./pages/admin/AdminCampaigns";
import AdminAdPlacements from "./pages/admin/AdminAdPlacements";
import AdminNutrition from "./pages/admin/AdminNutrition";
import AdminPayouts from "./pages/admin/AdminPayouts";
import AdminCustomerWallets from "./pages/admin/AdminCustomerWallets";
import AdminWalletFunding from "./pages/admin/AdminWalletFunding";
import AdminChargebacks from "./pages/admin/AdminChargebacks";
import AdminRefundAudit from "./pages/admin/AdminRefundAudit";
import AdminDisputes from "./pages/admin/AdminDisputes";
import AdminDeliveryCompanies from "./pages/admin/AdminDeliveryCompanies";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminReviews from "./pages/admin/AdminReviews";
import AdminPayroll from "./pages/admin/AdminPayroll";
import AdminReferrals from "./pages/admin/AdminReferrals";
import AdminExpenses from "./pages/admin/AdminExpenses";
import AdminRequisitions from "./pages/admin/AdminRequisitions";
import AdminLegal from "./pages/admin/AdminLegal";
import AdminFAQ from "./pages/admin/AdminFAQ";
import LegalPage from "./pages/legal/LegalPage";
import Install from "./pages/Install";
import Rewards from "./pages/Rewards";
import FreeMeals from "./pages/FreeMeals";
import AdminFreeMeals from "./pages/admin/AdminFreeMeals";
import TransactionHistoryPage from "./pages/profile/TransactionHistoryPage";
import WalletPage from "./pages/profile/WalletPage";
import NotFound from "./pages/NotFound";
import ProfileSetup from "./pages/ProfileSetup";
import CustomerSupport from "./pages/CustomerSupport";
import DeliveryCompanyAuth from "./pages/delivery/DeliveryCompanyAuth";
import DeliveryDashboard from "./pages/delivery/DeliveryDashboard";
import DeliveryOrders from "./pages/delivery/DeliveryOrders";
import DeliveryRiders from "./pages/delivery/DeliveryRiders";
import DeliveryEarnings from "./pages/delivery/DeliveryEarnings";
import DeliveryWithdraw from "./pages/delivery/DeliveryWithdraw";
import DeliverySettings from "./pages/delivery/DeliverySettings";
import DeliveryRiderJoin from "./pages/delivery/DeliveryRiderJoin";
import DeliverySupport from "./pages/delivery/DeliverySupport";
import DeliveryStaff from "./pages/delivery/DeliveryStaff";
import VendorSupport from "./pages/vendor/VendorSupport";
import VendorAdvertising from "./pages/vendor/VendorAdvertising";
import RiderSupport from "./pages/rider/RiderSupport";
import AdminSupport from "./pages/admin/AdminSupport";
import AdminNotifications from "./pages/admin/AdminNotifications";
import AdminCoverageAreas from "./pages/admin/AdminCoverageAreas";
import AdminFinancialTools from "./pages/admin/AdminFinancialTools";
import CoverageMap from "./pages/CoverageMap";
import WorkspaceLogin from "./pages/WorkspaceLogin";
import { playGlobalNotificationSound } from '@/lib/globalAudio';
import { useFcmNotifications } from '@/hooks/useFcmNotifications';
import { usePortalMemory } from '@/hooks/usePortalMemory';
import { useNativeOAuthHandler } from '@/hooks/useNativeOAuthHandler';

const queryClient = new QueryClient();

// Global listener for push notification sounds from service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'PLAY_NOTIFICATION_SOUND') {
      playGlobalNotificationSound();
    }
  });
}

const PortalTracker = () => {
  usePortalMemory();
  return null;
};

const App = () => {
  // Register FCM token on native Capacitor platforms
  useFcmNotifications();
  // Handle OAuth deep link callbacks on native platforms
  useNativeOAuthHandler();

  return (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <CartProvider>
        <TooltipProvider>
          <NetworkStatusOverlay />
          <ForceUpdateOverlay />
          <PWAUpdateBanner />
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <PortalTracker />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/vendor/:id" element={<VendorDetail />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/verification-pending" element={<VerificationPending />} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/profile/transactions" element={<TransactionHistoryPage />} />
              <Route path="/profile/wallet" element={<WalletPage />} />
              <Route path="/rewards" element={<Rewards />} />
              <Route path="/free-meals" element={<FreeMeals />} />
              <Route path="/profile-setup" element={<ProfileSetup />} />
              <Route path="/support" element={<CustomerSupport />} />
              <Route path="/coverage" element={<CoverageMap />} />
              {/* Landing Pages */}
              <Route path="/become-vendor" element={<VendorLanding />} />
              <Route path="/become-rider" element={<RiderLanding />} />
              <Route path="/become-partner" element={<DeliveryCompanyLanding />} />
              {/* Vendor Portal Routes */}
              <Route path="/vendor/auth" element={<VendorAuth />} />
              <Route path="/vendor/dashboard" element={<VendorDashboard />} />
              <Route path="/vendor/menu" element={<VendorMenu />} />
              <Route path="/vendor/orders" element={<VendorOrders />} />
              <Route path="/vendor/reviews" element={<VendorReviews />} />
              <Route path="/vendor/earnings" element={<VendorEarnings />} />
              <Route path="/vendor/withdraw" element={<VendorWithdraw />} />
              <Route path="/vendor/hours" element={<VendorHours />} />
              <Route path="/vendor/settings" element={<VendorSettings />} />
              <Route path="/vendor/store-settings" element={<VendorStoreSettings />} />
              <Route path="/vendor/promos" element={<VendorPromos />} />
              <Route path="/vendor/riders" element={<VendorRiders />} />
              <Route path="/vendor/staff" element={<VendorStaff />} />
              <Route path="/vendor/staff/join/:code" element={<VendorStaffJoin />} />
              <Route path="/vendor/staff-login/:vendorId?" element={<VendorStaffLogin />} />
              <Route path="/vendor/support" element={<VendorSupport />} />
              <Route path="/vendor/advertising" element={<VendorAdvertising />} />
              {/* Rider Portal Routes */}
              <Route path="/rider/auth" element={<RiderAuth />} />
              <Route path="/rider/dashboard" element={<RiderDashboard />} />
              <Route path="/rider/orders" element={<RiderOrders />} />
              <Route path="/rider/available-orders" element={<RiderAvailableOrders />} />
              <Route path="/rider/earnings" element={<RiderEarnings />} />
              <Route path="/rider/withdraw" element={<RiderWithdraw />} />
              <Route path="/rider/settings" element={<RiderSettings />} />
              <Route path="/rider/join/:code" element={<VendorRiderJoin />} />
              <Route path="/rider/support" element={<RiderSupport />} />
              {/* Admin Portal Routes */}
              <Route path="/admin/auth" element={<AdminAuth />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/orders" element={<AdminOrders />} />
              <Route path="/admin/vendors" element={<AdminVendors />} />
              <Route path="/admin/vendor-menus" element={<AdminVendorMenus />} />
              <Route path="/admin/riders" element={<AdminRiders />} />
              <Route path="/admin/promos" element={<AdminPromos />} />
              <Route path="/admin/commission-promos" element={<AdminVendorCommissionPromos />} />
              <Route path="/admin/rewards" element={<AdminRewards />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/staff" element={<AdminStaff />} />
              <Route path="/admin/staff/join/:code" element={<AdminStaffJoin />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/advertisements" element={<AdminAdvertisements />} />
              <Route path="/admin/campaigns" element={<AdminCampaigns />} />
              <Route path="/admin/ad-placements" element={<AdminAdPlacements />} />
              <Route path="/admin/nutrition" element={<AdminNutrition />} />
              <Route path="/admin/payouts" element={<AdminPayouts />} />
              <Route path="/admin/customer-wallets" element={<AdminCustomerWallets />} />
              <Route path="/admin/wallet-funding" element={<AdminWalletFunding />} />
              <Route path="/admin/chargebacks" element={<AdminChargebacks />} />
              <Route path="/admin/refund-audit" element={<AdminRefundAudit />} />
              <Route path="/admin/disputes" element={<AdminDisputes />} />
              <Route path="/admin/delivery-companies" element={<AdminDeliveryCompanies />} />
              <Route path="/admin/customers" element={<AdminCustomers />} />
              <Route path="/admin/reviews" element={<AdminReviews />} />
              <Route path="/admin/payroll" element={<AdminPayroll />} />
              <Route path="/admin/referrals" element={<AdminReferrals />} />
              <Route path="/admin/expenses" element={<AdminExpenses />} />
              <Route path="/admin/requisitions" element={<AdminRequisitions />} />
              <Route path="/admin/legal" element={<AdminLegal />} />
              <Route path="/admin/faq" element={<AdminFAQ />} />
              <Route path="/admin/support" element={<AdminSupport />} />
              <Route path="/admin/notifications" element={<AdminNotifications />} />
              <Route path="/admin/coverage-areas" element={<AdminCoverageAreas />} />
              <Route path="/admin/financial-tools" element={<AdminFinancialTools />} />
              {/* Legal Pages (public) */}
              <Route path="/legal" element={<LegalPage />} />
              <Route path="/legal/:type" element={<LegalPage />} />
              {/* Delivery Company Portal Routes */}
              <Route path="/delivery/auth" element={<DeliveryCompanyAuth />} />
              <Route path="/delivery/dashboard" element={<DeliveryDashboard />} />
              <Route path="/delivery/orders" element={<DeliveryOrders />} />
              <Route path="/delivery/riders" element={<DeliveryRiders />} />
              <Route path="/delivery/earnings" element={<DeliveryEarnings />} />
              <Route path="/delivery/withdraw" element={<DeliveryWithdraw />} />
              <Route path="/delivery/settings" element={<DeliverySettings />} />
              <Route path="/delivery/rider/join/:companyId" element={<DeliveryRiderJoin />} />
              <Route path="/delivery/support" element={<DeliverySupport />} />
              <Route path="/delivery/staff" element={<DeliveryStaff />} />
              {/* Workspace Login */}
              <Route path="/workspace/:slug" element={<WorkspaceLogin />} />
              {/* Install Page */}
              <Route path="/install" element={<Install />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </CartProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
