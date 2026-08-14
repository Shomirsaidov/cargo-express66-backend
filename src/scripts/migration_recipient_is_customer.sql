ALTER TABLE public.tracking_numbers ADD COLUMN IF NOT EXISTS recipient_is_customer BOOLEAN DEFAULT false;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS recipient_is_customer BOOLEAN DEFAULT false;
