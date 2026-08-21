-- Add column tech_rates to tariffs table to store device-specific delivery rates
ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS tech_rates JSONB DEFAULT '{}'::jsonb;

-- Seed default technology product rates for existing tariffs (USA, Germany, etc.)
UPDATE public.tariffs 
SET tech_rates = '{"macbook": 100, "laptop": 100, "iphone": 100, "watch": 30, "ipad": 70, "airpods": 20, "meta_glasses": 20, "airpods_max": 25, "ebook": 15}'::jsonb 
WHERE tech_rates IS NULL OR tech_rates = '{}'::jsonb;
