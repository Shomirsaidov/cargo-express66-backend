-- ============================================================================
-- Cargo Express 66 — ДИАГНОСТИКА проблемы с трек-номерами FedEx
-- ============================================================================
-- Этот файл ТОЛЬКО ЧИТАЕТ данные (никаких изменений). Безопасно запускать
-- на продакшене. Выполните его в Supabase → SQL Editor и пришлите результат.
--
-- Зачем: клиент вводит 12-значный трек-номер FedEx, а со сканера приходит
-- на 4–5 цифр больше. Система сравнивает значения строгим равенством
-- (.eq / = ), поэтому строки не находят друг друга.
--
-- Проверяем две гипотезы:
--   (1) у колонки tracking_number есть ОГРАНИЧЕНИЕ ДЛИНЫ (varchar(N)),
--       из-за которого значение со сканера обрезается;
--   (2) в базе реально лежат строки РАЗНОЙ длины (12 у клиента vs 16–17 со
--       сканера) — значит нужна нормализация/сравнение по последним цифрам.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Тип и максимальная длина колонок с трек-номерами
--    Ожидаем: data_type = 'text', character_maximum_length = NULL.
--    Если увидите character varying (N) — ЭТО И ЕСТЬ ПРИЧИНА ОБРЕЗКИ.
-- ────────────────────────────────────────────────────────────────────────────
SELECT
    table_name,
    column_name,
    data_type,
    character_maximum_length AS max_length,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name LIKE '%tracking%' OR column_name LIKE '%awb%')
ORDER BY table_name, column_name;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Реальные длины значений: видно ли, что сканер пишет ДЛИННЕЕ клиента?
-- ────────────────────────────────────────────────────────────────────────────
SELECT
    'parcels' AS source,
    length(tracking_number) AS len,
    count(*)                AS cnt
FROM public.parcels
GROUP BY 1, 2
UNION ALL
SELECT
    'tracking_numbers' AS source,
    length(tracking_number) AS len,
    count(*)                AS cnt
FROM public.tracking_numbers
GROUP BY 1, 2
ORDER BY source, len;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Примеры «пары», которые должны были соединиться, но не соединились.
--    Слева — что ввёл клиент (короткий), справа — что записал склад (длинный).
--    Совпадение по последним 12 цифрам = подтверждение гипотезы (2).
-- ────────────────────────────────────────────────────────────────────────────
SELECT
    p.tracking_number                              AS scanned_parcel,
    length(p.tracking_number)                      AS scanned_len,
    tn.tracking_number                             AS client_entered,
    length(tn.tracking_number)                     AS client_len,
    right(regexp_replace(p.tracking_number,  '\D', '', 'g'), 12) AS scanned_last12,
    right(regexp_replace(tn.tracking_number, '\D', '', 'g'), 12) AS client_last12,
    p.customer_id,
    tn.customer_id                                 AS tn_customer_id,
    p.created_at
FROM public.parcels p
JOIN public.tracking_numbers tn
  ON right(regexp_replace(p.tracking_number,  '\D', '', 'g'), 12)
   = right(regexp_replace(tn.tracking_number, '\D', '', 'g'), 12)
WHERE p.tracking_number <> tn.tracking_number          -- строки не равны буквально
ORDER BY p.created_at DESC
LIMIT 50;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. «Потеряшки»: посылки со сканера, у которых НЕТ привязанного клиента
--    (unknown_recipient) — вероятно, это и есть те самые ненайденные FedEx.
-- ────────────────────────────────────────────────────────────────────────────
SELECT
    id,
    tracking_number,
    length(tracking_number) AS len,
    status,
    customer_id,
    created_at
FROM public.parcels
WHERE customer_id IS NULL
ORDER BY created_at DESC
LIMIT 50;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Дубли по «нормализованному» номеру (одинаковые цифры, разное написание).
--    Если тут есть строки — значит уникальность по tracking_number не спасает
--    и нужно нормализованное сравнение.
-- ────────────────────────────────────────────────────────────────────────────
SELECT
    regexp_replace(upper(tracking_number), '[^A-Z0-9]', '', 'g') AS normalized,
    array_agg(DISTINCT tracking_number)  AS variants,
    count(*)                             AS cnt
FROM public.parcels
GROUP BY 1
HAVING count(*) > 1
ORDER BY cnt DESC
LIMIT 50;
