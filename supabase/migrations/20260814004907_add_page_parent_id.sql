alter table pages add column if not exists parent_id uuid references pages(id) on delete set null;

create index if not exists pages_parent_idx
  on pages (workspace_id, parent_id)
  where deleted_at is null;
