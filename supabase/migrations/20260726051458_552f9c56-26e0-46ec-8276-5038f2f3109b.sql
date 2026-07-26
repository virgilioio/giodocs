ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS pages_archived_at_idx ON public.pages (archived_at) WHERE archived_at IS NOT NULL;