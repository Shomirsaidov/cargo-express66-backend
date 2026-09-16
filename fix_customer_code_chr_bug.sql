-- ============================================================================
-- FIX: customer-code generation
--
-- Three separate defects, all in the customer_code path:
--
--   1. next_customer_code() declared `remainder` as bigint, so `chr(65 +
--      remainder)` was bigint and PostgreSQL (which only defines chr(integer))
--      raised "function chr(bigint) does not exist". Every registration failed.
--
--   2. register() never rolled back the Supabase Auth user when that happened,
--      leaving orphaned accounts that could neither log in nor re-register.
--      (Fixed in application code -- see src/controllers/authController.js and
--      src/scripts/find_orphaned_auth_users.js.)
--
--   3. The seeding DO block read `substr(customer_code, position, 1)` -- i.e.
--      characters 1-6 of "CX-AAAAFJ" = "CX-AAA" -- instead of the 6-letter
--      suffix. Every code in the CX-AAAAxx range collapsed to the same value
--      (33921680), so the sequence was seeded at ~33.9M instead of 140. New
--      customers would have jumped from CX-AAAAFJ straight to CX-CWGAAO.
--
-- Idempotent. Run the whole script in the Supabase SQL Editor.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Replace the broken function (defect 1)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_customer_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  value bigint := nextval('public.customer_code_sequence');
  result text := '';
  remainder integer;                      -- was: bigint  <-- the chr() bug
BEGIN
  FOR position IN 1..6 LOOP
    remainder := (value % 26)::integer;   -- explicit cast, never bigint
    result := chr(65 + remainder) || result;
    value := value / 26;
  END LOOP;

  RETURN 'CX-' || result;
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Where is the sequence now? (read-only -- note this down)
-- ----------------------------------------------------------------------------
SELECT last_value AS sequence_before FROM public.customer_code_sequence;


-- ----------------------------------------------------------------------------
-- 3. Reseed the sequence from the real high-water mark (defect 3)
--
--    `position + 3` skips the "CX-" prefix. The resulting index is strictly
--    greater than every existing customer_code, so it cannot collide with a
--    code already in use.
--
--    Caveat: if a customer row was ever deleted, its code could be reissued.
--    That is harmless for uniqueness but means codes are not a permanent
--    audit trail.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  next_index bigint;
BEGIN
  SELECT COALESCE(MAX(value), -1) + 1
  INTO next_index
  FROM (
    SELECT
      SUM((ascii(substr(customer_code, position + 3, 1)) - 65) * power(26, 6 - position))::bigint AS value
    FROM public.customers,
      generate_series(1, 6) AS position
    WHERE customer_code ~ '^CX-[A-Z]{6}$'
    GROUP BY customer_code
  ) codes;

  PERFORM setval('public.customer_code_sequence', next_index, false);
  RAISE NOTICE 'customer_code_sequence reseeded to %', next_index;
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. Verify: should report the reseeded position, then CX-AAAAFK / CX-AAAAFL
-- ----------------------------------------------------------------------------
SELECT last_value AS sequence_after FROM public.customer_code_sequence;

SELECT public.next_customer_code() AS next_code,
       public.next_customer_code() AS following_code;


-- ----------------------------------------------------------------------------
-- 5. Orphaned auth users left behind by the failed registrations (defect 2)
--    Prefer src/scripts/find_orphaned_auth_users.js --delete for cleanup.
-- ----------------------------------------------------------------------------
SELECT au.id AS auth_user_id, au.email, au.created_at
FROM auth.users au
LEFT JOIN public.customers c ON c.user_id = au.id
WHERE c.id IS NULL
ORDER BY au.created_at DESC;


-- ----------------------------------------------------------------------------
-- 6. Cleanup (OPTIONAL -- review section 5 first, then uncomment)
--    Deleting from auth.users cascades to public.customers, but this only
--    targets rows with no customers record, so nothing is lost.
-- ----------------------------------------------------------------------------
-- DELETE FROM auth.users au
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.customers c WHERE c.user_id = au.id
-- );


-- ----------------------------------------------------------------------------
-- 7. Out-of-range codes created by the mis-seeded sequence
--
--    Section 3 reseeds to "highest existing index + 1". If a customer has
--    ALREADY received a code from the bogus ~33.9M range (e.g. CX-CWGAAP),
--    that code IS the highest in the table, so the reseed correctly parks the
--    sequence up there -- and every future code stays in that range.
--
--    That is section 3 working as designed, not a failure. To get back to
--    clean sequential numbering you must renumber the affected customers
--    FIRST, then re-run section 3.
--
--    Review the list before changing anything: customer_code is shown to
--    customers in their profile.
-- ----------------------------------------------------------------------------
SELECT customer_code,
       SUM((ascii(substr(customer_code, position + 3, 1)) - 65) * power(26, 6 - position))::bigint AS code_index
FROM public.customers, generate_series(1, 6) AS position
WHERE customer_code ~ '^CX-[A-Z]{6}$'
GROUP BY customer_code
HAVING SUM((ascii(substr(customer_code, position + 3, 1)) - 65) * power(26, 6 - position)) > 10000
ORDER BY code_index;

-- Renumber them, then re-run section 3. Example (adjust to match the list above):
-- UPDATE public.customers SET customer_code = 'CX-AAAAFK' WHERE customer_code = 'CX-CWGAAP';
