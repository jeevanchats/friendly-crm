-- ============================================================
-- 0019_line_product_link.sql
-- Quote and order lines can point at the product they were made from (nullable: a line may be free text for odd jobs).
-- The line keeps its own name, unit, rate and GST (a snapshot), so renaming or re-pricing a product never changes a
-- quote already sent. The link is what lets reports group sales by product and lets the system spot spelling drift.
-- Deleting a product (which the app does not do; it archives) would leave the line intact, only unlinked.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0018.
-- ============================================================

ALTER TABLE "quotation_items" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotation_items_product_idx" ON "quotation_items" ("tenant_id", "product_id") WHERE "product_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_product_idx" ON "order_items" ("tenant_id", "product_id") WHERE "product_id" IS NOT NULL;
