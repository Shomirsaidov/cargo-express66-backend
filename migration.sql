-- Run this SQL in your Supabase SQL Editor to migrate the database:

-- One-time password reset codes. OTPs are stored as bcrypt hashes and expire quickly.
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid NOT NULL,
  otp_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS password_reset_otps_email_requested_idx
  ON public.password_reset_otps (email, requested_at DESC);

-- Convert legacy numeric codes once. This filter is intentional: rerunning this
-- migration must never renumber existing alphabetical customer codes.
CREATE OR REPLACE FUNCTION public.number_to_letters(num integer, length integer DEFAULT 6)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text := '';
  temp integer := num;
  remainder integer;
BEGIN
  IF length <= 0 THEN
    RETURN '';
  END IF;

  FOR i IN 1..length LOOP
    remainder := temp % 26;
    result := chr(65 + remainder) || result;
    temp := temp / 26;
  END LOOP;

  RETURN result;
END;
$$;

UPDATE public.customers c
SET customer_code = 'CX-' || public.number_to_letters(
  (substring(c.customer_code FROM '^CX66-([0-9]{6})$')::integer) - 1,
  6
)
WHERE c.customer_code ~ '^CX66-[0-9]{6}$';

-- Allocate new codes atomically. Unlike MAX(customer_code), a sequence cannot
-- return the same code to two concurrent registrations.
CREATE SEQUENCE IF NOT EXISTS public.customer_code_sequence
  AS bigint
  MINVALUE 0
  START WITH 0;

DO $$
DECLARE
  next_index bigint;
BEGIN
  SELECT COALESCE(MAX(value), -1) + 1
  INTO next_index
  FROM (
    SELECT
      SUM((ascii(substr(customer_code, position, 1)) - 65) * power(26, 6 - position))::bigint AS value
    FROM public.customers,
      generate_series(1, 6) AS position
    WHERE customer_code ~ '^CX-[A-Z]{6}$'
    GROUP BY customer_code
  ) codes;

  PERFORM setval('public.customer_code_sequence', next_index, false);
END;
$$;

-- NOTE: `remainder` must be integer, not bigint. PostgreSQL only defines
-- chr(integer); chr(bigint) does not exist, so `chr(65 + remainder)` fails with
-- "function chr(bigint) does not exist" and every registration breaks.
CREATE OR REPLACE FUNCTION public.next_customer_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  value bigint := nextval('public.customer_code_sequence');
  result text := '';
  remainder integer;
BEGIN
  FOR position IN 1..6 LOOP
    remainder := (value % 26)::integer;
    result := chr(65 + remainder) || result;
    value := value / 26;
  END LOOP;

  RETURN 'CX-' || result;
END;
$$;

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
