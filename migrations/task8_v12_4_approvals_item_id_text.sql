-- MMM OS v12.4 — Change approvals.item_id from UUID to TEXT
-- Allows non-UUID task/package refs like pkg_1779580017367 and dtask_1
-- Safe: existing UUID values are valid TEXT; no data loss
-- Run in Supabase SQL Editor (project: tldcwvtwjypmwynsklsd)

ALTER TABLE approvals ALTER COLUMN item_id TYPE TEXT;
