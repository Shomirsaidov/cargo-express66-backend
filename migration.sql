-- Run this SQL in your Supabase SQL Editor to migrate the database:

-- Add columns to tracking_numbers table
ALTER TABLE public.tracking_numbers ADD COLUMN IF NOT EXISTS additional_services UUID[] DEFAULT '{}';
ALTER TABLE public.tracking_numbers ADD COLUMN IF NOT EXISTS declared_value NUMERIC DEFAULT 0;

-- Update or insert additional services seed data
INSERT INTO public.additional_services (id, name, description, price, price_type, percentage, minimum_fee, is_active) VALUES
  ('e7a54f02-7c35-49a4-ad35-cf3f3f0a5678', 'Insurance', 'Full insurance cover for declared value (2%)', 0.00, 'percentage', 2.00, 0.00, true),
  ('f8b65003-8d46-4ab5-8e46-db4e4e1b6789', 'Inspection', 'Check parcel contents and packaging quality (+$5)', 5.00, 'fixed', 0.00, 0.00, true),
  ('11111111-2222-3333-4444-555555555555', 'Photo', 'Take a photo of contents (+$2)', 2.00, 'fixed', 0.00, 0.00, true),
  ('fa976004-9e57-4c06-8f57-eb5e5e2c7890', 'Functionality Check', 'Verify product works (+$10)', 10.00, 'fixed', 0.00, 0.00, true),
  ('22222222-3333-4444-5555-666666666666', 'Additional Packaging', 'Bubble wrap or extra box (+$2)', 2.00, 'fixed', 0.00, 0.00, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  price_type = EXCLUDED.price_type,
  percentage = EXCLUDED.percentage,
  minimum_fee = EXCLUDED.minimum_fee,
  is_active = EXCLUDED.is_active;
