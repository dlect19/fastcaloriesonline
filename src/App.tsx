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
import Favorites from "./pages/Favorites";
import VendorAuth from "./pages/vendor/VendorAuth";
import VendorDashboard from "./pages/vendor/VendorDashboard";
import VendorMenu from "./pages/vendor/VendorMenu";
import VendorOrders from "./pages/vendor/VendorOrders";
import VendorReviews from "./pages/vendor/VendorReviews";
import VendorEarnings from "./pages/vendor/VendorEarnings";
import VendorHours from "./pages/vendor/VendorHours";
import VendorSettings from "./pages/vendor/VendorSettings";
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
              <Route path="/favorites" element={<Favorites />} />
              {/* Vendor Portal Routes */}
              <Route path="/vendor/auth" element={<VendorAuth />} />
              <Route path="/vendor/dashboard" element={<VendorDashboard />} />
              <Route path="/vendor/menu" element={<VendorMenu />} />
              <Route path="/vendor/orders" element={<VendorOrders />} />
              <Route path="/vendor/reviews" element={<VendorReviews />} />
              <Route path="/vendor/earnings" element={<VendorEarnings />} />
              <Route path="/vendor/hours" element={<VendorHours />} />
              <Route path="/vendor/settings" element={<VendorSettings />} />
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
