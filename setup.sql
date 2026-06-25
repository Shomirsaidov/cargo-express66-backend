-- Drop existing tables to ensure clean slate (in correct order of dependencies)
DROP TABLE IF EXISTS public.parcel_status_history CASCADE;
DROP TABLE IF EXISTS public.parcel_services CASCADE;
DROP TABLE IF EXISTS public.tracking_numbers CASCADE;
DROP TABLE IF EXISTS public.airway_bill_parcels CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.parcels CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.warehouses CASCADE;
DROP TABLE IF EXISTS public.tariffs CASCADE;
DROP TABLE IF EXISTS public.additional_services CASCADE;
DROP TABLE IF EXISTS public.airway_bills CASCADE;
DROP TABLE IF EXISTS public.cms_pages CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: customers
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    customer_code TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    middle_name TEXT,
    phone TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    delivery_address TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'warehouse_employee', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign key reference to auth.users (Supabase managed auth)
ALTER TABLE public.customers 
  ADD CONSTRAINT fk_customers_user_id 
  FOREIGN KEY (user_id) 
  REFERENCES auth.users(id) 
  ON DELETE CASCADE;

-- Table: warehouses
CREATE TABLE public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: tariffs
CREATE TABLE public.tariffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country TEXT UNIQUE NOT NULL,
    price_per_kg NUMERIC NOT NULL,
    minimum_charge NUMERIC NOT NULL,
    delivery_time TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: additional_services
CREATE TABLE public.additional_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    price_type TEXT NOT NULL CHECK (price_type IN ('fixed', 'percentage')),
    percentage NUMERIC NOT NULL DEFAULT 0,
    minimum_fee NUMERIC NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: airway_bills
CREATE TABLE public.airway_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    awb_number TEXT UNIQUE NOT NULL,
    departure_country TEXT NOT NULL,
    departure_date TIMESTAMPTZ,
    arrival_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'in_transit', 'arrived', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: parcels
CREATE TABLE public.parcels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_number TEXT UNIQUE NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
    airway_bill_id UUID REFERENCES public.airway_bills(id) ON DELETE SET NULL,
    weight NUMERIC,
    dimensions TEXT,
    declared_value NUMERIC,
    insurance_cost NUMERIC NOT NULL DEFAULT 0,
    additional_services_cost NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'awaiting_arrival' CHECK (status IN (
      'awaiting_arrival',
      'received_at_warehouse',
      'processing',
      'assigned_to_flight',
      'dispatched',
      'in_transit',
      'arrived_in_dushanbe',
      'customs_clearance',
      'ready_for_pickup',
      'delivered',
      'unknown_recipient',
      'cancelled'
    )),
    arrival_date TIMESTAMPTZ,
    shipment_date TIMESTAMPTZ,
    delivery_date TIMESTAMPTZ,
    notes TEXT,
    photos TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: parcel_status_history
CREATE TABLE public.parcel_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parcel_id UUID REFERENCES public.parcels(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    changed_by UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: parcel_services
CREATE TABLE public.parcel_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parcel_id UUID REFERENCES public.parcels(id) ON DELETE CASCADE NOT NULL,
    service_id UUID REFERENCES public.additional_services(id) ON DELETE CASCADE NOT NULL,
    cost NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: tracking_numbers
CREATE TABLE public.tracking_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
    tracking_number TEXT NOT NULL,
    store_name TEXT,
    country_of_origin TEXT,
    warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
    notes TEXT,
    is_linked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_customer_tracking UNIQUE (customer_id, tracking_number)
);

-- Table: airway_bill_parcels
CREATE TABLE public.airway_bill_parcels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airway_bill_id UUID REFERENCES public.airway_bills(id) ON DELETE CASCADE NOT NULL,
    parcel_id UUID REFERENCES public.parcels(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_airway_bill_parcels UNIQUE (airway_bill_id, parcel_id),
    CONSTRAINT uq_parcel_id UNIQUE (parcel_id)
);

-- Table: notifications
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    parcel_id UUID REFERENCES public.parcels(id) ON DELETE SET NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: cms_pages
CREATE TABLE public.cms_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title_ru TEXT,
    title_en TEXT,
    content_ru TEXT,
    content_en TEXT,
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: settings
CREATE TABLE public.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function to automatically manage updated_at timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create Triggers
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_warehouses_updated_at BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_tariffs_updated_at BEFORE UPDATE ON public.tariffs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_additional_services_updated_at BEFORE UPDATE ON public.additional_services FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_airway_bills_updated_at BEFORE UPDATE ON public.airway_bills FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_parcels_updated_at BEFORE UPDATE ON public.parcels FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_tracking_numbers_updated_at BEFORE UPDATE ON public.tracking_numbers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_cms_pages_updated_at BEFORE UPDATE ON public.cms_pages FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Insert Seed Data: Warehouses
INSERT INTO public.warehouses (id, name, country, city, address, is_active) VALUES
('a3c10bdf-3e91-4560-b991-8bfbd9c61234', 'Munich Warehouse', 'Germany', 'Munich', 'Schwanthalerstraße 10', true),
('b4d21cef-4f02-5671-ca02-9c0ce0d72345', 'New York Warehouse', 'USA', 'New York', '123 JFK Blvd', true);

-- Insert Seed Data: Tariffs
INSERT INTO public.tariffs (id, country, price_per_kg, minimum_charge, delivery_time, is_active) VALUES
('c5e32df0-5a13-6782-db13-ad1df1e83456', 'Germany', 5.00, 10.00, '5-7 days', true),
('d6f43e01-6b24-4893-bc24-be2ef2f94567', 'USA', 8.00, 15.00, '7-10 days', true);

-- Insert Seed Data: Additional Services
INSERT INTO public.additional_services (id, name, description, price, price_type, percentage, minimum_fee, is_active) VALUES
('e7a54f02-7c35-49a4-ad35-cf3f3f0a5678', 'Insurance', 'Full insurance cover for declared value', 0.00, 'percentage', 2.00, 5.00, true),
('f8b65003-8d46-4ab5-8e46-db4e4e1b6789', 'Inspection', 'Check parcel contents and packaging quality', 5.00, 'fixed', 0.00, 0.00, true),
('fa976004-9e57-4c06-8f57-eb5e5e2c7890', 'Repackaging', 'Additional bubble wrap or protective box', 10.00, 'fixed', 0.00, 0.00, true);

-- Insert Seed Data: CMS Pages
INSERT INTO public.cms_pages (id, slug, title_ru, title_en, content_ru, content_en, is_published) VALUES
('11111111-1111-1111-1111-111111111111', 'about', 'О нас', 'About Us', 'Мы доставляем ваши посылки быстро и надежно по всему миру.', 'We deliver your packages quickly and reliably worldwide.', true),
('22222222-2222-2222-2222-222222222222', 'how-it-works', 'Как это работает', 'How It Works', '1. Зарегистрируйтесь на сайте\n2. Получите адрес склада за рубежом\n3. Укажите этот адрес при покупке\n4. Получите посылку в Душанбе', '1. Register on the website\n2. Get a warehouse address abroad\n3. Use this address during purchase\n4. Receive your package in Dushanbe', true),
('33333333-3333-3333-3333-333333333333', 'terms', 'Условия использования', 'Terms of Service', 'Правила и условия предоставления логистических услуг Cargo Express 66.', 'Terms and conditions for Cargo Express 66 logistics services.', true),
('44444444-4444-4444-4444-444444444444', 'faq', 'Часто задаваемые вопросы', 'FAQ', 'Ответы на часто задаваемые вопросы о сроках доставки, стоимости и запрещенных товарах.', 'Answers to frequently asked questions about delivery times, costs, and prohibited items.', true);

-- Insert Seed Data: Settings
INSERT INTO public.settings (key, value, description) VALUES
('company_name', 'Cargo Express 66', 'System company name'),
('contact_phone', '+992000000001', 'Contact phone number'),
('contact_email', 'info@cargo66.com', 'Contact email address'),
('office_address', 'Dushanbe, Tajikistan', 'Head office address');
