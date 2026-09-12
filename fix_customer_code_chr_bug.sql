-- ============================================================================
-- FIX: registration fails with "function chr(bigint) does not exist"
--
-- Cause: public.next_customer_code() declared `remainder` as bigint, so the
--        expression `65 + remainder` evaluated to bigint, and PostgreSQL only
--        defines chr(integer) -- there is no chr(bigint) overload.
--
-- This script is idempotent. Run it in the Supabase SQL Editor.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Replace the broken function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_customer_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  value bigint := nextval('public.customer_code_sequence');
  result text := '';
  remainder integer;                      -- was: bigint  <-- the bug
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
-- 2. Verify the fix -- should return CX-AAAAAA and CX-AAAAAB
-- ----------------------------------------------------------------------------
SELECT public.next_customer_code() AS first_code,
       public.next_customer_code() AS second_code;


-- ----------------------------------------------------------------------------
-- 3. Find orphaned auth users left behind by the failed registrations
--
--    authController.register creates the Supabase Auth user BEFORE inserting
--    the customers row. When next_customer_code() threw, the cleanup never ran,
--    so these users exist in auth.users with no matching public.customers row.
--    They cannot log in (login looks up public.customers) and they cannot
--    re-register (createUser returns "already registered" -> HTTP 409).
-- ----------------------------------------------------------------------------
SELECT au.id AS auth_user_id, au.email, au.created_at
FROM auth.users au
LEFT JOIN public.customers c ON c.user_id = au.id
WHERE c.id IS NULL
ORDER BY au.created_at DESC;


-- ----------------------------------------------------------------------------
-- 4. Clean up the orphaned auth users (OPTIONAL -- review section 3 first)
--
--    Deleting from auth.users cascades to public.customers via the
--    fk_customers_user_id ON DELETE CASCADE constraint, but the query below
--    only targets rows that have no customers record, so nothing is lost.
--
--    Prefer deleting through the Supabase dashboard (Authentication -> Users)
--    or the admin API if you want an audit trail. Uncomment to run.
-- ----------------------------------------------------------------------------
-- DELETE FROM auth.users au
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.customers c WHERE c.user_id = au.id
-- );


-- ----------------------------------------------------------------------------
-- 5. Confirm the sequence is still sane (should be >= 0)
-- ----------------------------------------------------------------------------
SELECT last_value, is_called FROM public.customer_code_sequence;
