-- ============================================================================
-- Cargo Express 66 — ИСПРАВЛЕНИЕ сопоставления трек-номеров (FedEx и др.)
-- ============================================================================
-- Запускать в Supabase → SQL Editor. Идемпотентно: можно прогонять повторно.
--
-- ЧТО ДЕЛАЕТ:
--   1) Убирает возможное ограничение длины у tracking_number (varchar(N) → text).
--      Именно оно обрезает номер со сканера и мешает сопоставлению.
--   2) Добавляет нормализованную колонку tracking_number_norm (только A-Z0-9,
--      верхний регистр) — заполняется автоматически триггером.
--   3) Индексирует нормализованные колонки для быстрого поиска.
--
-- ВАЖНО: приложение (backend) уже умеет сопоставлять 12-значный номер клиента
-- с более длинным кодом со сканера и работает даже БЕЗ этой миграции.
-- Миграция делает поиск устойчивым к пробелам/дефисам/регистру и быстрым.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Снять ограничение длины (если колонка была varchar(N))
--    Если колонка уже text — операция ничего не меняет и просто проходит.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.parcels           ALTER COLUMN tracking_number TYPE text;
ALTER TABLE public.tracking_numbers  ALTER COLUMN tracking_number TYPE text;

-- Обрезаем случайные пробелы по краям (безопасно, уникальность не нарушает)
UPDATE public.parcels
   SET tracking_number = btrim(tracking_number)
 WHERE tracking_number <> btrim(tracking_number);

UPDATE public.tracking_numbers
   SET tracking_number = btrim(tracking_number)
 WHERE tracking_number <> btrim(tracking_number);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Функция нормализации: "1Z 999-AA1" -> "1Z999AA1"
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_tracking_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]', '', 'g'), '');
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Нормализованные колонки + триггеры автозаполнения
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS tracking_number_norm text;

ALTER TABLE public.tracking_numbers
  ADD COLUMN IF NOT EXISTS tracking_number_norm text;

CREATE OR REPLACE FUNCTION public.parcels_set_tracking_norm()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tracking_number_norm := public.normalize_tracking_code(NEW.tracking_number);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tracking_numbers_set_tracking_norm()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tracking_number_norm := public.normalize_tracking_code(NEW.tracking_number);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parcels_tracking_norm ON public.parcels;
CREATE TRIGGER trg_parcels_tracking_norm
  BEFORE INSERT OR UPDATE OF tracking_number ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.parcels_set_tracking_norm();

DROP TRIGGER IF EXISTS trg_tracking_numbers_tracking_norm ON public.tracking_numbers;
CREATE TRIGGER trg_tracking_numbers_tracking_norm
  BEFORE INSERT OR UPDATE OF tracking_number ON public.tracking_numbers
  FOR EACH ROW EXECUTE FUNCTION public.tracking_numbers_set_tracking_norm();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Заполнить нормализованные значения для существующих строк
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.parcels
   SET tracking_number_norm = public.normalize_tracking_code(tracking_number)
 WHERE tracking_number_norm IS DISTINCT FROM public.normalize_tracking_code(tracking_number);

UPDATE public.tracking_numbers
   SET tracking_number_norm = public.normalize_tracking_code(tracking_number)
 WHERE tracking_number_norm IS DISTINCT FROM public.normalize_tracking_code(tracking_number);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Индексы
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parcels_tracking_number
  ON public.parcels (tracking_number);

CREATE INDEX IF NOT EXISTS idx_parcels_tracking_norm
  ON public.parcels (tracking_number_norm);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_tracking_number
  ON public.tracking_numbers (tracking_number);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_tracking_norm
  ON public.tracking_numbers (tracking_number_norm);

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- ПРОВЕРКА после миграции
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT tracking_number, tracking_number_norm
-- FROM public.parcels ORDER BY created_at DESC LIMIT 20;

-- ============================================================================
-- ДОПОЛНИТЕЛЬНО (по желанию, вручную): привязать «потеряшки» FedEx к клиентам.
-- Найди пары, где 12 последних цифр посылки совпадают с треком клиента,
-- и привяжи вручную через админку. Автоматическую привязку лучше делать
-- через интерфейс, чтобы не задеть историю статусов.
-- ============================================================================
-- SELECT
--   p.id AS parcel_id,
--   p.tracking_number AS scanned,
--   tn.customer_id,
--   tn.tracking_number AS client_track
-- FROM public.parcels p
-- JOIN public.tracking_numbers tn
--   ON right(p.tracking_number_norm, 12) = right(tn.tracking_number_norm, 12)
-- WHERE p.customer_id IS NULL
--   AND p.tracking_number <> tn.tracking_number;
