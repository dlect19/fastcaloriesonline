
-- Legal Documents table (version-controlled, admin-editable)
CREATE TABLE public.legal_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_type TEXT NOT NULL, -- 'terms', 'privacy', 'vendor_agreement', 'rider_agreement', 'logistics_agreement', 'refund_policy'
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- HTML content
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT true,
  requires_acceptance BOOLEAN NOT NULL DEFAULT true,
  force_reaccept BOOLEAN NOT NULL DEFAULT false,
  published_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_type, version)
);

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

-- Anyone can read current legal documents
CREATE POLICY "Anyone can view current legal documents"
  ON public.legal_documents FOR SELECT
  USING (is_current = true);

-- Admins can manage all legal documents
CREATE POLICY "Admins can manage legal documents"
  ON public.legal_documents FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Legal Acceptances table (acceptance log)
CREATE TABLE public.legal_acceptances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.legal_documents(id),
  document_type TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  role TEXT NOT NULL, -- 'customer', 'vendor', 'rider', 'logistics'
  ip_address TEXT,
  user_agent TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, document_id)
);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

-- Users can view own acceptances
CREATE POLICY "Users can view own acceptances"
  ON public.legal_acceptances FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert own acceptances
CREATE POLICY "Users can insert own acceptances"
  ON public.legal_acceptances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all acceptances
CREATE POLICY "Admins can view all acceptances"
  ON public.legal_acceptances FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Account Deletion Requests table
CREATE TABLE public.account_deletion_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'cancelled'
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create own deletion request"
  ON public.account_deletion_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own deletion requests"
  ON public.account_deletion_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can cancel own pending deletion"
  ON public.account_deletion_requests FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can manage all deletion requests"
  ON public.account_deletion_requests FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed initial legal documents
INSERT INTO public.legal_documents (document_type, title, content, version) VALUES
('terms', 'Terms & Conditions', '<h2>Terms & Conditions</h2><p>Welcome to FastCalories. By using our platform, you agree to the following terms...</p><h3>1. Account Registration</h3><p>You must provide accurate information when creating an account.</p><h3>2. Orders & Payments</h3><p>All orders are subject to availability. Payments are processed securely through our payment partners.</p><h3>3. Delivery</h3><p>Delivery times are estimates and may vary based on demand and distance.</p><h3>4. Cancellation</h3><p>Orders can be cancelled before preparation begins. Refunds are processed within 24 hours.</p><h3>5. Account Termination</h3><p>We reserve the right to suspend or terminate accounts that violate these terms.</p>', 1),
('privacy', 'Privacy Policy', '<h2>Privacy Policy</h2><p>Your privacy is important to us. This policy explains how we collect, use, and protect your data.</p><h3>1. Data Collection</h3><p>We collect information you provide during registration, ordering, and using our services.</p><h3>2. Data Usage</h3><p>Your data is used to process orders, improve our services, and communicate with you.</p><h3>3. Data Sharing</h3><p>We share minimal data with vendors and riders to fulfill your orders.</p><h3>4. Data Security</h3><p>We employ industry-standard security measures to protect your information.</p><h3>5. Your Rights</h3><p>You can request access to, correction, or deletion of your personal data.</p>', 1),
('vendor_agreement', 'Vendor Agreement', '<h2>Vendor Agreement</h2><p>This agreement governs your relationship with FastCalories as a vendor partner.</p><h3>1. Commission</h3><p>Vendors agree to pay a commission on each order processed through the platform.</p><h3>2. Quality Standards</h3><p>Vendors must maintain food safety and quality standards.</p><h3>3. Availability</h3><p>Vendors must keep menu items and operating hours up to date.</p><h3>4. Settlement</h3><p>Earnings are settled after the applicable hold period.</p>', 1),
('rider_agreement', 'Rider Agreement', '<h2>Rider Agreement</h2><p>This agreement governs your relationship with FastCalories as a delivery rider.</p><h3>1. Delivery Standards</h3><p>Riders must deliver orders promptly and professionally.</p><h3>2. Vehicle Requirements</h3><p>Riders must maintain their vehicles in safe working condition.</p><h3>3. Earnings</h3><p>Riders earn a share of the delivery fee for each completed delivery.</p><h3>4. Conduct</h3><p>Riders must behave professionally with customers and vendors.</p>', 1),
('logistics_agreement', 'Logistics Partner Agreement', '<h2>Logistics Partner Agreement</h2><p>This agreement governs your relationship with FastCalories as a logistics partner.</p><h3>1. Fleet Management</h3><p>Partners are responsible for managing their rider fleet.</p><h3>2. Commission</h3><p>Partners earn delivery revenue minus the platform commission.</p><h3>3. Standards</h3><p>Partners must ensure their riders meet delivery standards.</p><h3>4. Settlement</h3><p>Earnings are settled and available for withdrawal after processing.</p>', 1),
('refund_policy', 'Refund & Cancellation Policy', '<h2>Refund & Cancellation Policy</h2><p>We aim to provide a fair refund and cancellation process.</p><h3>1. Order Cancellation</h3><p>Orders can be cancelled before the vendor begins preparation.</p><h3>2. Refund Processing</h3><p>Approved refunds are processed within 24-48 hours.</p><h3>3. Non-Refundable</h3><p>Orders that have been prepared or delivered are generally non-refundable.</p><h3>4. Disputes</h3><p>Contact support for order disputes or quality issues.</p>', 1);

-- When a new version is published, mark old ones as not current
CREATE OR REPLACE FUNCTION public.handle_legal_document_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current = true THEN
    UPDATE public.legal_documents 
    SET is_current = false 
    WHERE document_type = NEW.document_type 
      AND id != NEW.id 
      AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_legal_document_insert
  BEFORE INSERT ON public.legal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_legal_document_version();
