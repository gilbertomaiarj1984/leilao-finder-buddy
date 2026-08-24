DROP POLICY IF EXISTS "app_state authenticated read" ON public.app_state;
DROP POLICY IF EXISTS "app_state authenticated write" ON public.app_state;
DROP POLICY IF EXISTS "app_state authenticated update" ON public.app_state;
REVOKE ALL ON public.app_state FROM authenticated;
REVOKE ALL ON public.app_state FROM anon;
GRANT ALL ON public.app_state TO service_role;
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;