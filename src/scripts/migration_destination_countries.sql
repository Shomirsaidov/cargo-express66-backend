-- 1. Create table public.destination_countries
CREATE TABLE IF NOT EXISTS public.destination_countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed destination countries
INSERT INTO public.destination_countries (name, is_active)
VALUES
    ('Таджикистан', true),
    ('Узбекистан', true),
    ('Азербайджан', true),
    ('Казахстан', true),
    ('Киргизия', true)
ON CONFLICT (name) DO NOTHING;

-- 3. Add column destination_country to public.tracking_numbers and public.parcels
ALTER TABLE public.tracking_numbers ADD COLUMN IF NOT EXISTS destination_country TEXT DEFAULT 'Таджикистан';
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS destination_country TEXT DEFAULT 'Таджикистан';
