
-- 1. Drug Categories
CREATE TABLE public.drug_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drug_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drug categories readable by everyone" ON public.drug_categories FOR SELECT USING (true);
CREATE POLICY "Admins can manage drug categories" ON public.drug_categories FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Drug Database (Central Catalog)
CREATE TABLE public.drug_database (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  generic_name TEXT,
  category_id UUID REFERENCES public.drug_categories(id) ON DELETE SET NULL,
  dosage_form TEXT NOT NULL DEFAULT 'tablet',
  strength TEXT,
  description TEXT,
  requires_prescription BOOLEAN NOT NULL DEFAULT false,
  manufacturer TEXT,
  side_effects TEXT[],
  contraindications TEXT[],
  common_dosage_instructions TEXT,
  default_dosage_frequency TEXT DEFAULT 'twice_daily',
  default_dosage_duration_days INTEGER,
  default_quantity_per_dose INTEGER DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drug_database ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drug database readable by everyone" ON public.drug_database FOR SELECT USING (true);
CREATE POLICY "Admins can manage drug database" ON public.drug_database FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_drug_database_category ON public.drug_database(category_id);
CREATE INDEX idx_drug_database_name ON public.drug_database USING gin(to_tsvector('english', name));

-- 3. Add drug_database_id to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS drug_database_id UUID REFERENCES public.drug_database(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pharmacist_dosage_instructions TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_dosage_frequency TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_dosage_duration_days INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_quantity_per_dose INTEGER DEFAULT 1;

-- 4. Prescription Orders
CREATE TABLE public.prescription_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  is_prescription BOOLEAN NOT NULL DEFAULT false,
  prescription_image_url TEXT,
  doctor_instructions TEXT,
  pharmacist_instructions TEXT,
  dosage_frequency TEXT NOT NULL DEFAULT 'twice_daily',
  dosage_duration_days INTEGER NOT NULL DEFAULT 7,
  quantity_per_dose INTEGER NOT NULL DEFAULT 1,
  total_quantity INTEGER NOT NULL DEFAULT 1,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.prescription_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prescription orders" ON public.prescription_orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own prescription orders" ON public.prescription_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Vendors can view their prescription orders" ON public.prescription_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = vendor_id AND v.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.vendor_staff vs WHERE vs.vendor_id = prescription_orders.vendor_id AND vs.user_id = auth.uid() AND vs.is_active = true)
);
CREATE POLICY "Vendors can update prescription orders" ON public.prescription_orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = vendor_id AND v.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.vendor_staff vs WHERE vs.vendor_id = prescription_orders.vendor_id AND vs.user_id = auth.uid() AND vs.is_active = true)
);
CREATE POLICY "Admins can manage prescription orders" ON public.prescription_orders FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_prescription_orders_order ON public.prescription_orders(order_id);
CREATE INDEX idx_prescription_orders_user ON public.prescription_orders(user_id);

-- 5. Drug Usage Tracking
CREATE TABLE public.drug_usage_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prescription_order_id UUID NOT NULL REFERENCES public.prescription_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  drug_name TEXT NOT NULL,
  total_doses INTEGER NOT NULL DEFAULT 1,
  doses_taken INTEGER NOT NULL DEFAULT 0,
  doses_remaining INTEGER GENERATED ALWAYS AS (total_doses - doses_taken) STORED,
  next_dose_at TIMESTAMPTZ,
  last_taken_at TIMESTAMPTZ,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completion_percentage NUMERIC GENERATED ALWAYS AS (CASE WHEN total_doses > 0 THEN ROUND((doses_taken::numeric / total_doses) * 100, 1) ELSE 0 END) STORED,
  started_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drug_usage_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own drug usage" ON public.drug_usage_tracking FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own drug usage" ON public.drug_usage_tracking FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own drug usage" ON public.drug_usage_tracking FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all drug usage" ON public.drug_usage_tracking FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_drug_usage_user ON public.drug_usage_tracking(user_id);
CREATE INDEX idx_drug_usage_prescription ON public.drug_usage_tracking(prescription_order_id);

-- 6. Link drug_reminders to prescription_orders
ALTER TABLE public.drug_reminders ADD COLUMN IF NOT EXISTS prescription_order_id UUID REFERENCES public.prescription_orders(id) ON DELETE SET NULL;
ALTER TABLE public.drug_reminders ADD COLUMN IF NOT EXISTS drug_usage_tracking_id UUID REFERENCES public.drug_usage_tracking(id) ON DELETE SET NULL;

-- 7. Seed Drug Categories
INSERT INTO public.drug_categories (name, description, icon, sort_order) VALUES
('Analgesics & Pain Relief', 'Pain relievers and fever reducers', '💊', 1),
('Antibiotics', 'Anti-bacterial medications', '🦠', 2),
('Antimalarials', 'Malaria treatment and prevention', '🦟', 3),
('Antifungals', 'Antifungal medications', '🍄', 4),
('Antihistamines & Allergy', 'Allergy and antihistamine medications', '🤧', 5),
('Antihypertensives', 'Blood pressure medications', '❤️', 6),
('Antidiabetics', 'Diabetes management medications', '🩸', 7),
('Vitamins & Supplements', 'Nutritional supplements and vitamins', '🥗', 8),
('Gastrointestinal', 'Stomach and digestive medications', '🫃', 9),
('Respiratory', 'Cough, cold and respiratory medications', '🫁', 10),
('Dermatological', 'Skin care and dermatological treatments', '🧴', 11),
('Cardiovascular', 'Heart and circulatory system medications', '🫀', 12),
('Anti-inflammatories', 'Non-steroidal anti-inflammatory drugs', '🔥', 13),
('Antivirals', 'Antiviral medications', '🧬', 14),
('Eye & Ear Care', 'Ophthalmic and otic medications', '👁️', 15),
('Reproductive Health', 'Family planning and reproductive health', '🩺', 16),
('CNS Drugs', 'Central nervous system medications', '🧠', 17),
('Antiseptics & Disinfectants', 'Wound care and disinfectants', '🧼', 18);

-- 8. Seed Common Drugs
-- Analgesics
INSERT INTO public.drug_database (name, generic_name, category_id, dosage_form, strength, requires_prescription, common_dosage_instructions, default_dosage_frequency, default_dosage_duration_days, default_quantity_per_dose) VALUES
('Paracetamol', 'Acetaminophen', (SELECT id FROM drug_categories WHERE name = 'Analgesics & Pain Relief'), 'tablet', '500mg', false, 'Take 1-2 tablets every 4-6 hours as needed. Do not exceed 8 tablets in 24 hours.', 'every_6_hours', 3, 1),
('Ibuprofen', 'Ibuprofen', (SELECT id FROM drug_categories WHERE name = 'Analgesics & Pain Relief'), 'tablet', '400mg', false, 'Take 1 tablet every 6-8 hours after food.', 'three_times_daily', 5, 1),
('Diclofenac', 'Diclofenac Sodium', (SELECT id FROM drug_categories WHERE name = 'Analgesics & Pain Relief'), 'tablet', '50mg', false, 'Take 1 tablet twice daily after meals.', 'twice_daily', 5, 1),
('Tramadol', 'Tramadol HCl', (SELECT id FROM drug_categories WHERE name = 'Analgesics & Pain Relief'), 'capsule', '50mg', true, 'Take 1 capsule every 6 hours as directed by your doctor.', 'every_6_hours', 5, 1),
('Aspirin', 'Acetylsalicylic Acid', (SELECT id FROM drug_categories WHERE name = 'Analgesics & Pain Relief'), 'tablet', '300mg', false, 'Take 1 tablet every 4-6 hours as needed after food.', 'three_times_daily', 3, 1),

-- Antibiotics
('Amoxicillin', 'Amoxicillin Trihydrate', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'capsule', '500mg', true, 'Take 1 capsule three times daily for 7 days. Complete the full course.', 'three_times_daily', 7, 1),
('Ciprofloxacin', 'Ciprofloxacin HCl', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'tablet', '500mg', true, 'Take 1 tablet twice daily for 5-7 days.', 'twice_daily', 7, 1),
('Metronidazole', 'Metronidazole', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'tablet', '400mg', true, 'Take 1 tablet three times daily for 7 days. Avoid alcohol.', 'three_times_daily', 7, 1),
('Azithromycin', 'Azithromycin', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'tablet', '500mg', true, 'Take 1 tablet daily for 3 days.', 'once_daily', 3, 1),
('Augmentin', 'Amoxicillin/Clavulanate', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'tablet', '625mg', true, 'Take 1 tablet twice daily for 7 days after meals.', 'twice_daily', 7, 1),
('Doxycycline', 'Doxycycline Hyclate', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'capsule', '100mg', true, 'Take 1 capsule twice daily with water. Avoid lying down for 30 mins after.', 'twice_daily', 7, 1),
('Erythromycin', 'Erythromycin', (SELECT id FROM drug_categories WHERE name = 'Antibiotics'), 'tablet', '500mg', true, 'Take 1 tablet four times daily before meals.', 'four_times_daily', 7, 1),

-- Antimalarials
('Coartem', 'Artemether/Lumefantrine', (SELECT id FROM drug_categories WHERE name = 'Antimalarials'), 'tablet', '20/120mg', true, 'Take 4 tablets at 0, 8, 24, 36, 48 and 60 hours. Take with fatty food.', 'twice_daily', 3, 4),
('Lonart', 'Artemether/Lumefantrine', (SELECT id FROM drug_categories WHERE name = 'Antimalarials'), 'tablet', '80/480mg', true, 'Take as directed. Adult dose: specific schedule over 3 days.', 'twice_daily', 3, 1),
('Artesunate', 'Artesunate', (SELECT id FROM drug_categories WHERE name = 'Antimalarials'), 'tablet', '200mg', true, 'Take as prescribed by doctor for severe malaria.', 'once_daily', 3, 1),
('Chloroquine', 'Chloroquine Phosphate', (SELECT id FROM drug_categories WHERE name = 'Antimalarials'), 'tablet', '250mg', true, 'Take as prescribed. Usually loading dose then maintenance.', 'once_daily', 3, 2),

-- Antihistamines
('Loratadine', 'Loratadine', (SELECT id FROM drug_categories WHERE name = 'Antihistamines & Allergy'), 'tablet', '10mg', false, 'Take 1 tablet once daily.', 'once_daily', 7, 1),
('Cetirizine', 'Cetirizine HCl', (SELECT id FROM drug_categories WHERE name = 'Antihistamines & Allergy'), 'tablet', '10mg', false, 'Take 1 tablet once daily preferably at night.', 'once_daily', 7, 1),
('Piriton', 'Chlorpheniramine Maleate', (SELECT id FROM drug_categories WHERE name = 'Antihistamines & Allergy'), 'tablet', '4mg', false, 'Take 1 tablet every 4-6 hours. May cause drowsiness.', 'three_times_daily', 5, 1),

-- Gastrointestinal
('Omeprazole', 'Omeprazole', (SELECT id FROM drug_categories WHERE name = 'Gastrointestinal'), 'capsule', '20mg', false, 'Take 1 capsule daily before breakfast for up to 14 days.', 'once_daily', 14, 1),
('Loperamide', 'Loperamide HCl', (SELECT id FROM drug_categories WHERE name = 'Gastrointestinal'), 'capsule', '2mg', false, 'Take 2 capsules initially, then 1 after each loose stool. Max 8 per day.', 'as_needed', 2, 2),
('ORS', 'Oral Rehydration Salts', (SELECT id FROM drug_categories WHERE name = 'Gastrointestinal'), 'sachet', '20.5g', false, 'Dissolve 1 sachet in 1 litre of clean water. Sip frequently.', 'as_needed', 3, 1),
('Buscopan', 'Hyoscine Butylbromide', (SELECT id FROM drug_categories WHERE name = 'Gastrointestinal'), 'tablet', '10mg', false, 'Take 2 tablets three times daily for stomach cramps.', 'three_times_daily', 3, 2),
('Antacid', 'Aluminium/Magnesium Hydroxide', (SELECT id FROM drug_categories WHERE name = 'Gastrointestinal'), 'suspension', '200ml', false, 'Take 10-20ml after meals and at bedtime.', 'three_times_daily', 7, 1),

-- Vitamins
('Vitamin C', 'Ascorbic Acid', (SELECT id FROM drug_categories WHERE name = 'Vitamins & Supplements'), 'tablet', '1000mg', false, 'Take 1 tablet daily.', 'once_daily', 30, 1),
('Multivitamin', 'Multivitamin Complex', (SELECT id FROM drug_categories WHERE name = 'Vitamins & Supplements'), 'tablet', 'Standard', false, 'Take 1 tablet daily after breakfast.', 'once_daily', 30, 1),
('Folic Acid', 'Folic Acid', (SELECT id FROM drug_categories WHERE name = 'Vitamins & Supplements'), 'tablet', '5mg', false, 'Take 1 tablet daily. Essential during pregnancy.', 'once_daily', 30, 1),
('Ferrous Sulphate', 'Iron Supplement', (SELECT id FROM drug_categories WHERE name = 'Vitamins & Supplements'), 'tablet', '200mg', false, 'Take 1 tablet daily on empty stomach with vitamin C.', 'once_daily', 30, 1),
('Calcium + Vitamin D', 'Calcium/Cholecalciferol', (SELECT id FROM drug_categories WHERE name = 'Vitamins & Supplements'), 'tablet', '600mg/400IU', false, 'Take 1 tablet daily with meals.', 'once_daily', 30, 1),

-- Antihypertensives
('Amlodipine', 'Amlodipine Besylate', (SELECT id FROM drug_categories WHERE name = 'Antihypertensives'), 'tablet', '5mg', true, 'Take 1 tablet once daily. Do not stop without doctor advice.', 'once_daily', 30, 1),
('Lisinopril', 'Lisinopril', (SELECT id FROM drug_categories WHERE name = 'Antihypertensives'), 'tablet', '10mg', true, 'Take 1 tablet once daily.', 'once_daily', 30, 1),
('Losartan', 'Losartan Potassium', (SELECT id FROM drug_categories WHERE name = 'Antihypertensives'), 'tablet', '50mg', true, 'Take 1 tablet once daily.', 'once_daily', 30, 1),

-- Antidiabetics
('Metformin', 'Metformin HCl', (SELECT id FROM drug_categories WHERE name = 'Antidiabetics'), 'tablet', '500mg', true, 'Take 1 tablet twice daily with meals.', 'twice_daily', 30, 1),
('Glibenclamide', 'Glyburide', (SELECT id FROM drug_categories WHERE name = 'Antidiabetics'), 'tablet', '5mg', true, 'Take 1 tablet daily with breakfast.', 'once_daily', 30, 1),

-- Respiratory
('Salbutamol Inhaler', 'Salbutamol', (SELECT id FROM drug_categories WHERE name = 'Respiratory'), 'inhaler', '100mcg', true, '2 puffs as needed for breathing difficulty. Max 8 puffs per day.', 'as_needed', 30, 2),
('Cough Syrup', 'Dextromethorphan/Guaifenesin', (SELECT id FROM drug_categories WHERE name = 'Respiratory'), 'syrup', '100ml', false, 'Take 10ml three times daily.', 'three_times_daily', 5, 1),
('Prednisolone', 'Prednisolone', (SELECT id FROM drug_categories WHERE name = 'Respiratory'), 'tablet', '5mg', true, 'Take as prescribed. Do not stop suddenly.', 'once_daily', 5, 1),

-- Anti-inflammatories
('Piroxicam', 'Piroxicam', (SELECT id FROM drug_categories WHERE name = 'Anti-inflammatories'), 'capsule', '20mg', false, 'Take 1 capsule daily after food.', 'once_daily', 7, 1),
('Naproxen', 'Naproxen', (SELECT id FROM drug_categories WHERE name = 'Anti-inflammatories'), 'tablet', '500mg', false, 'Take 1 tablet twice daily after food.', 'twice_daily', 7, 1),

-- Dermatological
('Clotrimazole Cream', 'Clotrimazole', (SELECT id FROM drug_categories WHERE name = 'Dermatological'), 'cream', '1%', false, 'Apply thinly to affected area twice daily for 2-4 weeks.', 'twice_daily', 14, 1),
('Hydrocortisone Cream', 'Hydrocortisone', (SELECT id FROM drug_categories WHERE name = 'Dermatological'), 'cream', '1%', false, 'Apply thinly to affected area 1-2 times daily. Do not use on face for prolonged periods.', 'twice_daily', 7, 1),

-- Antivirals
('Acyclovir', 'Acyclovir', (SELECT id FROM drug_categories WHERE name = 'Antivirals'), 'tablet', '200mg', true, 'Take 1 tablet five times daily for 5 days.', 'five_times_daily', 5, 1),

-- Antifungals
('Fluconazole', 'Fluconazole', (SELECT id FROM drug_categories WHERE name = 'Antifungals'), 'capsule', '150mg', true, 'Take 1 capsule as a single dose or as prescribed.', 'once_daily', 1, 1),
('Ketoconazole', 'Ketoconazole', (SELECT id FROM drug_categories WHERE name = 'Antifungals'), 'tablet', '200mg', true, 'Take 1 tablet daily with meals for 2-4 weeks.', 'once_daily', 14, 1),

-- Eye Care
('Chloramphenicol Eye Drops', 'Chloramphenicol', (SELECT id FROM drug_categories WHERE name = 'Eye & Ear Care'), 'eye drops', '0.5%', false, 'Apply 1 drop every 2 hours initially, then reduce.', 'every_2_hours', 5, 1),

-- Antiseptics
('Povidone Iodine', 'Povidone-Iodine', (SELECT id FROM drug_categories WHERE name = 'Antiseptics & Disinfectants'), 'solution', '10%', false, 'Apply to wounds as needed for antiseptic cleaning.', 'as_needed', 7, 1),

-- Cardiovascular
('Atorvastatin', 'Atorvastatin', (SELECT id FROM drug_categories WHERE name = 'Cardiovascular'), 'tablet', '20mg', true, 'Take 1 tablet daily at night.', 'once_daily', 30, 1);
