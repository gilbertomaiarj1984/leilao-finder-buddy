CREATE TABLE IF NOT EXISTS public.app_state (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE ON public.app_state TO authenticated;
GRANT ALL ON public.app_state TO service_role;

ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_state authenticated read" ON public.app_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_state authenticated write" ON public.app_state FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "app_state authenticated update" ON public.app_state FOR UPDATE TO authenticated USING (true) WITH CHECK (true);