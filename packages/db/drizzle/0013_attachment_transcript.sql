-- ============================================================
-- 0013_attachment_transcript.sql
-- The words of a voice note (taken down by the browser while recording, and editable by staff), so the
-- quotation can be pre-filled from what the customer said without sending audio anywhere.
-- ============================================================
ALTER TABLE "lead_attachments" ADD COLUMN IF NOT EXISTS "transcript" text;
