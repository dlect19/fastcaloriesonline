import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { PhoneVerificationGate } from "@/components/auth/PhoneVerificationGate";
import { CartProvider } from "@/hooks/useCart";
import { CallProvider } from "@/components/call/CallProvider";
import { MedicationAlarmBootstrap } from "@/components/pharmacy/MedicationAlarmBootstrap";
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
const VendorAuth = lazy(() => import("./pages/vendor/VendorAuth"));
const VendorDashboard = lazy(() => import("./pages/vendor/VendorDashboard"));
const VendorMenu = lazy(() => import("./pages/vendor/VendorMenu"));
const VendorOrders = lazy(() => import("./pages/vendor/VendorOrders"));
const VendorReviews = lazy(() => import("./pages/vendor/VendorReviews"));
const VendorEarnings = lazy(() => import("./pages/vendor/VendorEarnings"));
const VendorWithdraw = lazy(() => import("./pages/vendor/VendorWithdraw"));
const VendorHours = lazy(() => import("./pages/vendor/VendorHours"));
const VendorSettings = lazy(() => import("./pages/vendor/VendorSettings"));
const VendorStoreSettings = lazy(() => import("./pages/vendor/VendorStoreSettings"));
const VendorPromos = lazy(() => import("./pages/vendor/VendorPromos"));
const VendorVoucherVerify = lazy(() => import("./pages/vendor/VendorVoucherVerify"));
const VendorRiders = lazy(() => import("./pages/vendor/VendorRiders"));
const VendorStaff = lazy(() => import("./pages/vendor/VendorStaff"));
const VendorPharmacyReview = lazy(() => import("./pages/vendor/VendorPharmacyReview"));
const VendorStaffJoin = lazy(() => import("./pages/vendor/VendorStaffJoin"));
const VendorStaffLogin = lazy(() => import("./pages/vendor/VendorStaffLogin"));
const VendorRiderJoin = lazy(() => import("./pages/rider/VendorRiderJoin"));
const RiderAuth = lazy(() => import("./pages/rider/RiderAuth"));
const RiderDashboard = lazy(() => import("./pages/rider/RiderDashboard"));
const RiderOrders = lazy(() => import("./pages/rider/RiderOrders"));
const RiderAvailableOrders = lazy(() => import("./pages/rider/RiderAvailableOrders"));
const RiderEarnings = lazy(() => import("./pages/rider/RiderEarnings"));
const RiderWithdraw = lazy(() => import("./pages/rider/RiderWithdraw"));
const RiderSettings = lazy(() => import("./pages/rider/RiderSettings"));
const AdminAuth = lazy(() => import("./pages/admin/AdminAuth"));
const AdminRouteGuard = lazy(() => import("./components/admin/AdminRouteGuard"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AssistedOrdersList = lazy(() => import("./pages/admin/AssistedOrdersList"));
const AssistedOrderCreate = lazy(() => import("./pages/admin/AssistedOrderCreate"));
const AssistedOrderDetail = lazy(() => import("./pages/admin/AssistedOrderDetail"));
const AdminShadowCredits = lazy(() => import("./pages/admin/AdminShadowCredits"));
import Track from "./pages/Track";
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders"));
const AdminPosReports = lazy(() => import("./pages/admin/AdminPosReports"));
const AdminVendors = lazy(() => import("./pages/admin/AdminVendors"));
const AdminVendorMenus = lazy(() => import("./pages/admin/AdminVendorMenus"));
const AdminCuisineCategories = lazy(() => import("./pages/admin/AdminCuisineCategories"));
const AdminPharmacyAnalytics = lazy(() => import("./pages/admin/AdminPharmacyAnalytics"));
const AdminRiders = lazy(() => import("./pages/admin/AdminRiders"));
const AdminPromos = lazy(() => import("./pages/admin/AdminPromos"));
const AdminVendorCommissionPromos = lazy(() => import("./pages/admin/AdminVendorCommissionPromos"));
const AdminRewards = lazy(() => import("./pages/admin/AdminRewards"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminTwilioCosts = lazy(() => import("./pages/admin/AdminTwilioCosts"));
const AdminWhatsAppCosts = lazy(() => import("./pages/admin/AdminWhatsAppCosts"));
const AdminCallLogs = lazy(() => import("./pages/admin/AdminCallLogs"));
const AdminStaff = lazy(() => import("./pages/admin/AdminStaff"));
const AdminActivityLogs = lazy(() => import("./pages/admin/AdminActivityLogs"));
const AdminSecurity = lazy(() => import("./pages/admin/AdminSecurity"));
const AdminStaffJoin = lazy(() => import("./pages/admin/AdminStaffJoin"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminWeatherSettings = lazy(() => import("./pages/admin/AdminWeatherSettings"));
const AdminSurgeSettings = lazy(() => import("./pages/admin/AdminSurgeSettings"));
const AdminAdvertisements = lazy(() => import("./pages/admin/AdminAdvertisements"));
const AdminCampaigns = lazy(() => import("./pages/admin/AdminCampaigns"));
const AdminAdPlacements = lazy(() => import("./pages/admin/AdminAdPlacements"));
const AdminNutrition = lazy(() => import("./pages/admin/AdminNutrition"));
const AdminPayouts = lazy(() => import("./pages/admin/AdminPayouts"));
const AdminOnHoldPayments = lazy(() => import("./pages/admin/AdminOnHoldPayments"));
const AdminWhatsApp = lazy(() => import("./pages/admin/AdminWhatsApp"));
const AdminWhatsAppLaunch = lazy(() => import("./pages/admin/AdminWhatsAppLaunch"));

const AdminPhoneVerification = lazy(() => import("./pages/admin/AdminPhoneVerification"));
const AdminCustomerWallets = lazy(() => import("./pages/admin/AdminCustomerWallets"));
const AdminWalletFunding = lazy(() => import("./pages/admin/AdminWalletFunding"));
const AdminPaystackAudit = lazy(() => import("./pages/admin/AdminPaystackAudit"));
const AdminChargebacks = lazy(() => import("./pages/admin/AdminChargebacks"));
const AdminRefundAudit = lazy(() => import("./pages/admin/AdminRefundAudit"));
const AdminLedgerAudit = lazy(() => import("./pages/admin/AdminLedgerAudit"));
const AdminWalletIntegrity = lazy(() => import("./pages/admin/AdminWalletIntegrity"));
const AdminCheckoutIntegrity = lazy(() => import("./pages/admin/AdminCheckoutIntegrity"));
const AdminReconciliation = lazy(() => import("./pages/admin/AdminReconciliation"));
const AdminDisputes = lazy(() => import("./pages/admin/AdminDisputes"));
const AdminDeliveryCompanies = lazy(() => import("./pages/admin/AdminDeliveryCompanies"));
const AdminCustomers = lazy(() => import("./pages/admin/AdminCustomers"));
const AdminReviews = lazy(() => import("./pages/admin/AdminReviews"));
const AdminPayroll = lazy(() => import("./pages/admin/AdminPayroll"));
const AdminReferrals = lazy(() => import("./pages/admin/AdminReferrals"));
const AdminExpenses = lazy(() => import("./pages/admin/AdminExpenses"));
const AdminRequisitions = lazy(() => import("./pages/admin/AdminRequisitions"));
const AdminLegal = lazy(() => import("./pages/admin/AdminLegal"));
const AdminFAQ = lazy(() => import("./pages/admin/AdminFAQ"));
import LegalPage from "./pages/legal/LegalPage";
import Install from "./pages/Install";
import GetApp from "./pages/GetApp";
import Rewards from "./pages/Rewards";
import FreeMeals from "./pages/FreeMeals";
const AdminFreeMeals = lazy(() => import("./pages/admin/AdminFreeMeals"));
import TransactionHistoryPage from "./pages/profile/TransactionHistoryPage";
import WalletPage from "./pages/profile/WalletPage";
import NotFound from "./pages/NotFound";
import ProfileSetup from "./pages/ProfileSetup";
import CustomerSupport from "./pages/CustomerSupport";
const DeliveryCompanyAuth = lazy(() => import("./pages/delivery/DeliveryCompanyAuth"));
const DeliveryDashboard = lazy(() => import("./pages/delivery/DeliveryDashboard"));
const DeliveryOrders = lazy(() => import("./pages/delivery/DeliveryOrders"));
const DeliveryRiders = lazy(() => import("./pages/delivery/DeliveryRiders"));
const DeliveryEarnings = lazy(() => import("./pages/delivery/DeliveryEarnings"));
const DeliveryWithdraw = lazy(() => import("./pages/delivery/DeliveryWithdraw"));
const DeliverySettings = lazy(() => import("./pages/delivery/DeliverySettings"));
const DeliveryRiderJoin = lazy(() => import("./pages/delivery/DeliveryRiderJoin"));
const DeliverySupport = lazy(() => import("./pages/delivery/DeliverySupport"));
const DeliveryStaff = lazy(() => import("./pages/delivery/DeliveryStaff"));
const VendorSupport = lazy(() => import("./pages/vendor/VendorSupport"));
const VendorAdvertising = lazy(() => import("./pages/vendor/VendorAdvertising"));
const VendorPos = lazy(() => import("./pages/vendor/VendorPos"));
const VendorPosReports = lazy(() => import("./pages/vendor/VendorPosReports"));
const VendorPosPricing = lazy(() => import("./pages/vendor/VendorPosPricing"));
const RiderSupport = lazy(() => import("./pages/rider/RiderSupport"));
const AdminSupport = lazy(() => import("./pages/admin/AdminSupport"));
const AdminNotifications = lazy(() => import("./pages/admin/AdminNotifications"));
const AdminCoverageAreas = lazy(() => import("./pages/admin/AdminCoverageAreas"));
const AdminFinancialTools = lazy(() => import("./pages/admin/AdminFinancialTools"));
const AdminAmbassadors = lazy(() => import("./pages/admin/AdminAmbassadors"));
const AdminDrugDatabase = lazy(() => import("./pages/admin/AdminDrugDatabase"));
import NutritionReport from "./pages/NutritionReport";
import DrugTracker from "./pages/DrugTracker";
import DeleteAccount from "./pages/DeleteAccount";
import CoverageMap from "./pages/CoverageMap";
import WorkspaceLogin from "./pages/WorkspaceLogin";
import WhatsAppMiniApp from "./pages/WhatsAppMiniApp";
import EventsList from "./pages/EventsList";
import EventDetail from "./pages/EventDetail";
import MyEvents from "./pages/MyEvents";
const AdminEvents = lazy(() => import("./pages/admin/AdminEvents"));
const AdminEventDetail = lazy(() => import("./pages/admin/AdminEventDetail"));
const AdminEventDashboard = lazy(() => import("./pages/admin/AdminEventDashboard"));
const AdminEventsAnalytics = lazy(() => import("./pages/admin/AdminEventsAnalytics"));
import OrganizerPortal from "./pages/OrganizerPortal";
import OrganizerVerify from "./pages/OrganizerVerify";
import OrganizerAuth from "./pages/OrganizerAuth";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import EventPlannersLanding from "./pages/EventPlannersLanding";
const AdminEventVerify = lazy(() => import("./pages/admin/AdminEventVerify"));
const VendorVoucherHub = lazy(() => import("./pages/vendor/VendorVoucherHub"));
import VouchersList from "./pages/vouchers/VouchersList";
import VoucherCategory from "./pages/vouchers/VoucherCategory";
import MyVouchers from "./pages/vouchers/MyVouchers";
const AdminVoucherHub = lazy(() => import("./pages/admin/AdminVoucherHub"));
import VoucherStorefront from "./pages/public/VoucherStorefront";
import VoucherStorefrontSuccess from "./pages/public/VoucherStorefrontSuccess";
import { ORDER_SOUND_EVENT_TYPES, pushEventId, soundKey } from '@/lib/orderSoundGate';
import { isStaffPortalPath } from '@/lib/portalScope';
import { useFcmNotifications } from '@/hooks/useFcmNotifications';
import { usePortalMemory } from '@/hooks/usePortalMemory';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useNativeOAuthHandler } from '@/hooks/useNativeOAuthHandler';
import { useCustomerChatNotifications } from '@/hooks/useCustomerChatNotifications';

const queryClient = new QueryClient();

// Service-worker order-sound messages are honoured only inside staff portals.
// The order-audio module is loaded lazily there; customer routes never load it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'PLAY_NOTIFICATION_SOUND') return;
    if (!isStaffPortalPath(window.location.pathname)) return;
    const d = event.data?.data;
    if (!d || !ORDER_SOUND_EVENT_TYPES.has(d.type)) return;
    const role = d.type === 'NEW_ORDER' ? (d.role === 'admin' ? 'admin' : 'vendor') : 'rider';
    const eventType = d.type === 'RIDER_ASSIGNED' ? 'assigned' : 'actionable';
    const key = soundKey(role, eventType, event.data?.eventId || pushEventId(d));
    import('@/lib/globalAudio').then((m) => m.playOrderSoundOnce(key)).catch(() => {});
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
            <MedicationAlarmBootstrap />
            <Suspense fallback={null}>
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
              {/* All admin pages behind the shared 2FA guard */}
              <Route element={<AdminRouteGuard />}>
                <Route path="/admin/voucher-hub" element={<AdminVoucherHub />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/orders" element={<AdminOrders />} />
                <Route path="/admin/assisted-orders" element={<AssistedOrdersList />} />
                <Route path="/admin/assisted-orders/new" element={<AssistedOrderCreate />} />
                <Route path="/admin/assisted-orders/:orderId" element={<AssistedOrderDetail />} />
                <Route path="/admin/shadow-credits" element={<AdminShadowCredits />} />
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
                <Route path="/admin/whatsapp-costs" element={<AdminWhatsAppCosts />} />
                <Route path="/admin/call-logs" element={<AdminCallLogs />} />
                <Route path="/admin/staff" element={<AdminStaff />} />
                <Route path="/admin/activity-logs" element={<AdminActivityLogs />} />
                <Route path="/admin/security" element={<AdminSecurity />} />
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
                <Route path="/admin/whatsapp-launch" element={<AdminWhatsAppLaunch />} />

                <Route path="/admin/phone-verification" element={<AdminPhoneVerification />} />
                <Route path="/admin/customer-wallets" element={<AdminCustomerWallets />} />
                <Route path="/admin/wallet-funding" element={<AdminWalletFunding />} />
                <Route path="/admin/paystack-audit" element={<AdminPaystackAudit />} />
                <Route path="/admin/chargebacks" element={<AdminChargebacks />} />
                <Route path="/admin/refund-audit" element={<AdminRefundAudit />} />
                <Route path="/admin/ledger-audit" element={<AdminLedgerAudit />} />
                <Route path="/admin/wallet-integrity" element={<AdminWalletIntegrity />} />
                <Route path="/admin/checkout-integrity" element={<AdminCheckoutIntegrity />} />
                <Route path="/admin/reconciliation" element={<AdminReconciliation />} />
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
                <Route path="/admin/events" element={<AdminEvents />} />
                <Route path="/admin/events-analytics" element={<AdminEventsAnalytics />} />
                <Route path="/admin/events/:id" element={<AdminEventDetail />} />
                <Route path="/admin/events/:id/dashboard" element={<AdminEventDashboard />} />
                <Route path="/admin/event-verify" element={<AdminEventVerify />} />
              </Route>
              <Route path="/track/:orderNumber" element={<Track />} />
              <Route path="/admin/staff/join/:code" element={<AdminStaffJoin />} />
              {/* Admin Events */}
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
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
        </CallProvider>
      </CartProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
