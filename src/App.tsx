import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { PhoneVerificationGate } from "@/components/auth/PhoneVerificationGate";
import { CartProvider } from "@/hooks/useCart";
import { CallProvider } from "@/components/call/CallProvider";
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
import WhatsAppFundingSuccess from "./pages/WhatsAppFundingSuccess";
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
import VendorVoucherVerify from "./pages/vendor/VendorVoucherVerify";
import VendorRiders from "./pages/vendor/VendorRiders";
import VendorStaff from "./pages/vendor/VendorStaff";
import VendorPharmacyReview from "./pages/vendor/VendorPharmacyReview";
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
import AssistedOrdersList from "./pages/admin/AssistedOrdersList";
import AssistedOrderCreate from "./pages/admin/AssistedOrderCreate";
import AssistedOrderDetail from "./pages/admin/AssistedOrderDetail";
import AdminShadowCredits from "./pages/admin/AdminShadowCredits";
import Track from "./pages/Track";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminPosReports from "./pages/admin/AdminPosReports";
import AdminVendors from "./pages/admin/AdminVendors";
import AdminVendorMenus from "./pages/admin/AdminVendorMenus";
import AdminCuisineCategories from "./pages/admin/AdminCuisineCategories";
import AdminPharmacyAnalytics from "./pages/admin/AdminPharmacyAnalytics";
import AdminRiders from "./pages/admin/AdminRiders";
import AdminPromos from "./pages/admin/AdminPromos";
import AdminVendorCommissionPromos from "./pages/admin/AdminVendorCommissionPromos";
import AdminRewards from "./pages/admin/AdminRewards";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminTwilioCosts from "./pages/admin/AdminTwilioCosts";
import AdminCallLogs from "./pages/admin/AdminCallLogs";
import AdminStaff from "./pages/admin/AdminStaff";
import AdminActivityLogs from "./pages/admin/AdminActivityLogs";
import AdminSecurity from "./pages/admin/AdminSecurity";
import AdminStaffJoin from "./pages/admin/AdminStaffJoin";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminWeatherSettings from "./pages/admin/AdminWeatherSettings";
import AdminSurgeSettings from "./pages/admin/AdminSurgeSettings";
import AdminAdvertisements from "./pages/admin/AdminAdvertisements";
import AdminCampaigns from "./pages/admin/AdminCampaigns";
import AdminAdPlacements from "./pages/admin/AdminAdPlacements";
import AdminNutrition from "./pages/admin/AdminNutrition";
import AdminPayouts from "./pages/admin/AdminPayouts";
import AdminOnHoldPayments from "./pages/admin/AdminOnHoldPayments";
import AdminWhatsApp from "./pages/admin/AdminWhatsApp";
import AdminPhoneVerification from "./pages/admin/AdminPhoneVerification";
import AdminCustomerWallets from "./pages/admin/AdminCustomerWallets";
import AdminWalletFunding from "./pages/admin/AdminWalletFunding";
import AdminChargebacks from "./pages/admin/AdminChargebacks";
import AdminRefundAudit from "./pages/admin/AdminRefundAudit";
import AdminLedgerAudit from "./pages/admin/AdminLedgerAudit";
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
import GetApp from "./pages/GetApp";
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
import VendorPos from "./pages/vendor/VendorPos";
import VendorPosReports from "./pages/vendor/VendorPosReports";
import VendorPosPricing from "./pages/vendor/VendorPosPricing";
import RiderSupport from "./pages/rider/RiderSupport";
import AdminSupport from "./pages/admin/AdminSupport";
import AdminNotifications from "./pages/admin/AdminNotifications";
import AdminCoverageAreas from "./pages/admin/AdminCoverageAreas";
import AdminFinancialTools from "./pages/admin/AdminFinancialTools";
import AdminAmbassadors from "./pages/admin/AdminAmbassadors";
import AdminDrugDatabase from "./pages/admin/AdminDrugDatabase";
import NutritionReport from "./pages/NutritionReport";
import DrugTracker from "./pages/DrugTracker";
import DeleteAccount from "./pages/DeleteAccount";
import CoverageMap from "./pages/CoverageMap";
import WorkspaceLogin from "./pages/WorkspaceLogin";
import WhatsAppMiniApp from "./pages/WhatsAppMiniApp";
import EventsList from "./pages/EventsList";
import EventDetail from "./pages/EventDetail";
import MyEvents from "./pages/MyEvents";
import AdminEvents from "./pages/admin/AdminEvents";
import AdminEventDetail from "./pages/admin/AdminEventDetail";
import AdminEventDashboard from "./pages/admin/AdminEventDashboard";
import AdminEventsAnalytics from "./pages/admin/AdminEventsAnalytics";
import OrganizerPortal from "./pages/OrganizerPortal";
import OrganizerVerify from "./pages/OrganizerVerify";
import OrganizerAuth from "./pages/OrganizerAuth";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import EventPlannersLanding from "./pages/EventPlannersLanding";
import AdminEventVerify from "./pages/admin/AdminEventVerify";
import VendorVoucherHub from "./pages/vendor/VendorVoucherHub";
import VouchersList from "./pages/vouchers/VouchersList";
import VoucherCategory from "./pages/vouchers/VoucherCategory";
import MyVouchers from "./pages/vouchers/MyVouchers";
import AdminVoucherHub from "./pages/admin/AdminVoucherHub";
import VoucherStorefront from "./pages/public/VoucherStorefront";
import VoucherStorefrontSuccess from "./pages/public/VoucherStorefrontSuccess";
import { playGlobalNotificationSound } from '@/lib/globalAudio';
import { useFcmNotifications } from '@/hooks/useFcmNotifications';
import { usePortalMemory } from '@/hooks/usePortalMemory';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useNativeOAuthHandler } from '@/hooks/useNativeOAuthHandler';
import { useCustomerChatNotifications } from '@/hooks/useCustomerChatNotifications';

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

const AppThemeMount = () => {
  useAppTheme();
  return null;
};

const CustomerChatNotifier = () => {
  useCustomerChatNotifications();
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
        <CallProvider>
        <TooltipProvider>
          <NetworkStatusOverlay />
          <ForceUpdateOverlay />
          <PWAUpdateBanner />
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <PortalTracker />
            <AppThemeMount />
            <CustomerChatNotifier />
            <PhoneVerificationGate />
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
              <Route path="/wallet/wa-success" element={<WhatsAppFundingSuccess />} />
              <Route path="/profile/transactions" element={<TransactionHistoryPage />} />
              <Route path="/profile/wallet" element={<WalletPage />} />
              <Route path="/rewards" element={<Rewards />} />
              <Route path="/free-meals" element={<FreeMeals />} />
              <Route path="/profile-setup" element={<ProfileSetup />} />
              <Route path="/support" element={<CustomerSupport />} />
              <Route path="/coverage" element={<CoverageMap />} />
              <Route path="/nutrition-report" element={<NutritionReport />} />
              <Route path="/drug-tracker" element={<DrugTracker />} />
              {/* Events */}
              <Route path="/events" element={<EventsList />} />
              <Route path="/events/:id" element={<EventDetail />} />
              <Route path="/my-events" element={<MyEvents />} />
              {/* Landing Pages */}
              <Route path="/become-vendor" element={<VendorLanding />} />
              <Route path="/become-rider" element={<RiderLanding />} />
              <Route path="/become-partner" element={<DeliveryCompanyLanding />} />
              {/* Vendor Portal Routes */}
              <Route path="/vendor/auth" element={<VendorAuth />} />
              <Route path="/vendor/dashboard" element={<VendorDashboard />} />
              <Route path="/vendor/menu" element={<VendorMenu />} />
              <Route path="/vendor/orders" element={<VendorOrders />} />
              <Route path="/vendor/pharmacy-review" element={<VendorPharmacyReview />} />
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
              <Route path="/vendor/pos" element={<VendorPos />} />
              <Route path="/vendor/pos/reports" element={<VendorPosReports />} />
              <Route path="/vendor/pos/pricing" element={<VendorPosPricing />} />
              <Route path="/vendor/voucher-verify" element={<VendorVoucherVerify />} />
              <Route path="/vendor/voucher-hub" element={<VendorVoucherHub />} />
              {/* Voucher Hub (customer) */}
              <Route path="/vouchers" element={<VouchersList />} />
              <Route path="/vouchers/my" element={<MyVouchers />} />
              <Route path="/vouchers/:id" element={<VoucherCategory />} />
              <Route path="/admin/voucher-hub" element={<AdminVoucherHub />} />
              {/* Public voucher storefront (no login) */}
              <Route path="/v/:slug" element={<VoucherStorefront />} />
              <Route path="/v/:slug/success" element={<VoucherStorefrontSuccess />} />
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
              <Route path="/admin/assisted-orders" element={<AssistedOrdersList />} />
              <Route path="/admin/assisted-orders/new" element={<AssistedOrderCreate />} />
              <Route path="/admin/assisted-orders/:orderId" element={<AssistedOrderDetail />} />
              <Route path="/admin/shadow-credits" element={<AdminShadowCredits />} />
              <Route path="/track/:orderNumber" element={<Track />} />
              <Route path="/admin/pos-reports" element={<AdminPosReports />} />
              <Route path="/admin/vendors" element={<AdminVendors />} />
              <Route path="/admin/vendor-menus" element={<AdminVendorMenus />} />
              <Route path="/admin/cuisine-categories" element={<AdminCuisineCategories />} />
              <Route path="/admin/pharmacy-analytics" element={<AdminPharmacyAnalytics />} />
              <Route path="/admin/riders" element={<AdminRiders />} />
              <Route path="/admin/promos" element={<AdminPromos />} />
              <Route path="/admin/commission-promos" element={<AdminVendorCommissionPromos />} />
              <Route path="/admin/rewards" element={<AdminRewards />} />
              <Route path="/admin/free-meals" element={<AdminFreeMeals />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/twilio-costs" element={<AdminTwilioCosts />} />
              <Route path="/admin/call-logs" element={<AdminCallLogs />} />
              <Route path="/admin/staff" element={<AdminStaff />} />
              <Route path="/admin/activity-logs" element={<AdminActivityLogs />} />
              <Route path="/admin/security" element={<AdminSecurity />} />
              <Route path="/admin/staff/join/:code" element={<AdminStaffJoin />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/weather" element={<AdminWeatherSettings />} />
              <Route path="/admin/surge" element={<AdminSurgeSettings />} />
              <Route path="/admin/advertisements" element={<AdminAdvertisements />} />
              <Route path="/admin/campaigns" element={<AdminCampaigns />} />
              <Route path="/admin/ad-placements" element={<AdminAdPlacements />} />
              <Route path="/admin/nutrition" element={<AdminNutrition />} />
              <Route path="/admin/payouts" element={<AdminPayouts />} />
              <Route path="/admin/on-hold-payments" element={<AdminOnHoldPayments />} />
              <Route path="/admin/whatsapp" element={<AdminWhatsApp />} />
              <Route path="/admin/phone-verification" element={<AdminPhoneVerification />} />
              <Route path="/admin/customer-wallets" element={<AdminCustomerWallets />} />
              <Route path="/admin/wallet-funding" element={<AdminWalletFunding />} />
              <Route path="/admin/chargebacks" element={<AdminChargebacks />} />
              <Route path="/admin/refund-audit" element={<AdminRefundAudit />} />
              <Route path="/admin/ledger-audit" element={<AdminLedgerAudit />} />
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
              <Route path="/admin/ambassadors" element={<AdminAmbassadors />} />
              <Route path="/admin/drug-database" element={<AdminDrugDatabase />} />
              {/* Admin Events */}
              <Route path="/admin/events" element={<AdminEvents />} />
              <Route path="/admin/events-analytics" element={<AdminEventsAnalytics />} />
              <Route path="/admin/events/:id" element={<AdminEventDetail />} />
              <Route path="/admin/events/:id/dashboard" element={<AdminEventDashboard />} />
              <Route path="/admin/event-verify" element={<AdminEventVerify />} />
              {/* Organizer Portal (public via secret token) */}
              <Route path="/organizer/:token" element={<OrganizerPortal />} />
              <Route path="/organizer/:token/verify" element={<OrganizerVerify />} />
              {/* Event planner self-service portal */}
              <Route path="/organizer/auth" element={<OrganizerAuth />} />
              <Route path="/organizer/dashboard" element={<OrganizerDashboard />} />
              {/* Public marketing page */}
              <Route path="/event-planners" element={<EventPlannersLanding />} />
              {/* Public Pages */}
              <Route path="/delete-account" element={<DeleteAccount />} />
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
              {/* Customer App Download Page */}
              <Route path="/get-app" element={<GetApp />} />
              <Route path="/download" element={<GetApp />} />
              {/* WhatsApp Mini-App */}
              <Route path="/wa/:sessionId" element={<WhatsAppMiniApp />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
        </CallProvider>
      </CartProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
