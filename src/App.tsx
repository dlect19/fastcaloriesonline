import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { CartProvider } from "@/hooks/useCart";
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
import VendorAuth from "./pages/vendor/VendorAuth";
import VendorDashboard from "./pages/vendor/VendorDashboard";
import VendorMenu from "./pages/vendor/VendorMenu";
import VendorOrders from "./pages/vendor/VendorOrders";
import VendorReviews from "./pages/vendor/VendorReviews";
import VendorEarnings from "./pages/vendor/VendorEarnings";
import VendorWithdraw from "./pages/vendor/VendorWithdraw";
import VendorHours from "./pages/vendor/VendorHours";
import VendorSettings from "./pages/vendor/VendorSettings";
import VendorPromos from "./pages/vendor/VendorPromos";
import VendorRiders from "./pages/vendor/VendorRiders";
import VendorStaff from "./pages/vendor/VendorStaff";
import VendorRiderJoin from "./pages/rider/VendorRiderJoin";
import RiderAuth from "./pages/rider/RiderAuth";
import RiderDashboard from "./pages/rider/RiderDashboard";
import RiderOrders from "./pages/rider/RiderOrders";
import RiderEarnings from "./pages/rider/RiderEarnings";
import RiderWithdraw from "./pages/rider/RiderWithdraw";
import RiderSettings from "./pages/rider/RiderSettings";
import AdminAuth from "./pages/admin/AdminAuth";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminVendors from "./pages/admin/AdminVendors";
import AdminRiders from "./pages/admin/AdminRiders";
import AdminPromos from "./pages/admin/AdminPromos";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminStaff from "./pages/admin/AdminStaff";
import AdminSettings from "./pages/admin/AdminSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <CartProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
              <Route path="/vendor/promos" element={<VendorPromos />} />
              <Route path="/vendor/riders" element={<VendorRiders />} />
              <Route path="/vendor/staff" element={<VendorStaff />} />
              {/* Rider Portal Routes */}
              <Route path="/rider/auth" element={<RiderAuth />} />
              <Route path="/rider/dashboard" element={<RiderDashboard />} />
              <Route path="/rider/orders" element={<RiderOrders />} />
              <Route path="/rider/earnings" element={<RiderEarnings />} />
              <Route path="/rider/withdraw" element={<RiderWithdraw />} />
              <Route path="/rider/settings" element={<RiderSettings />} />
              <Route path="/rider/join/:code" element={<VendorRiderJoin />} />
              {/* Admin Portal Routes */}
              <Route path="/admin/auth" element={<AdminAuth />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/orders" element={<AdminOrders />} />
              <Route path="/admin/vendors" element={<AdminVendors />} />
              <Route path="/admin/riders" element={<AdminRiders />} />
              <Route path="/admin/promos" element={<AdminPromos />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/staff" element={<AdminStaff />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </CartProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
