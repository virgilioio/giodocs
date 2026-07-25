-- 1. Add nullable presentational icon column on views
ALTER TABLE public.views ADD COLUMN IF NOT EXISTS icon text;

-- 2. Seed icons on personal views (Allan + other seed owner). Team views remain iconless.
UPDATE public.views SET icon = '🗂'  WHERE scope='personal' AND name='Assigned to me';
UPDATE public.views SET icon = '📓'  WHERE scope='personal' AND name='Recently edited';
UPDATE public.views SET icon = '🔍'  WHERE scope='personal' AND name='Needs review';

-- 3. Merge an "icon" key into each option in the area property_def, preserving existing keys.
UPDATE public.property_defs
SET options = (
  SELECT jsonb_agg(
    CASE opt->>'value'
      WHEN 'Design'      THEN opt || jsonb_build_object('icon','🎨')
      WHEN 'Engineering' THEN opt || jsonb_build_object('icon','🔧')
      WHEN 'Hiring'      THEN opt || jsonb_build_object('icon','🤝')
      WHEN 'Ops'         THEN opt || jsonb_build_object('icon','📦')
      WHEN 'Product'     THEN opt || jsonb_build_object('icon','🧭')
      ELSE opt
    END
  )
  FROM jsonb_array_elements(options) opt
)
WHERE key = 'area';