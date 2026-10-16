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
--   3) Добавляет tracking_number_tail — последние 12 символов номера.
--      ЭТО ГЛАВНОЕ для нового правила сопоставления: сканер часто захватывает
--      лишние СИМВОЛЫ В НАЧАЛЕ (префикс маршрута, индекс, штрих-кодовая набивка),
--      поэтому начала номеров разные, а ОКОНЧАНИЯ совпадают. Индекс по tail
--      позволяет искать «одинаковое окончание» за один индексный проход, а не
--      полным сканированием таблицы.
--   4) Индексирует всё это.
--
-- ВАЖНО: приложение (backend) уже умеет сопоставлять по окончанию и работает
-- даже БЕЗ этой миграции (через шаблон LIKE '%...'). Миграция нужна, чтобы
-- поиск был индексным и быстрым на больших объёмах.
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

-- Последние 12 символов — «одинаковое окончание».
ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS tracking_number_tail text;

ALTER TABLE public.tracking_numbers
  ADD COLUMN IF NOT EXISTS tracking_number_tail text;

CREATE OR REPLACE FUNCTION public.parcels_set_tracking_norm()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tracking_number_norm := public.normalize_tracking_code(NEW.tracking_number);
  NEW.tracking_number_tail := right(NEW.tracking_number_norm, 12);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tracking_numbers_set_tracking_norm()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tracking_number_norm := public.normalize_tracking_code(NEW.tracking_number);
  NEW.tracking_number_tail := right(NEW.tracking_number_norm, 12);
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

-- Окончания (12 символов)
UPDATE public.parcels
   SET tracking_number_tail = right(public.normalize_tracking_code(tracking_number), 12)
 WHERE tracking_number_tail IS DISTINCT FROM right(public.normalize_tracking_code(tracking_number), 12);

UPDATE public.tracking_numbers
   SET tracking_number_tail = right(public.normalize_tracking_code(tracking_number), 12)
 WHERE tracking_number_tail IS DISTINCT FROM right(public.normalize_tracking_code(tracking_number), 12);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Индексы
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parcels_tracking_number
  ON public.parcels (tracking_number);

CREATE INDEX IF NOT EXISTS idx_parcels_tracking_norm
  ON public.parcels (tracking_number_norm);

-- Главный индекс нового правила: поиск «такого же окончания» за один проход.
CREATE INDEX IF NOT EXISTS idx_parcels_tracking_tail
  ON public.parcels (tracking_number_tail);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_tracking_number
  ON public.tracking_numbers (tracking_number);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_tracking_norm
  ON public.tracking_numbers (tracking_number_norm);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_tracking_tail
  ON public.tracking_numbers (tracking_number_tail);

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- ПРОВЕРКА после миграции
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT tracking_number, tracking_number_norm, tracking_number_tail
-- FROM public.parcels ORDER BY created_at DESC LIMIT 20;

-- Сколько посылок без клиента нашли бы владельца по окончанию:
-- SELECT count(*)
-- FROM public.parcels p
-- JOIN public.tracking_numbers tn
--   ON p.tracking_number_tail = tn.tracking_number_tail
-- WHERE p.customer_id IS NULL
--   AND length(p.tracking_number_tail) = 12;

-- ============================================================================
-- ДОПОЛНИТЕЛЬНО (по желанию, вручную): привязать «потеряшки» FedEx к клиентам.
-- Автоматическую привязку лучше делать через интерфейс (ShipmentsPage →
-- «Назначить клиента»), чтобы не задеть историю статусов.
-- ============================================================================
-- SELECT
--   p.id AS parcel_id,
--   p.tracking_number AS scanned,
--   tn.customer_id,
--   tn.tracking_number AS client_track
-- FROM public.parcels p
-- JOIN public.tracking_numbers tn
--   ON p.tracking_number_tail = tn.tracking_number_tail
-- WHERE p.customer_id IS NULL
--   AND p.tracking_number <> tn.tracking_number
--   AND length(p.tracking_number_tail) = 12;
