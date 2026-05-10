ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "stock_mode" TEXT NOT NULL DEFAULT 'PRODUCT_ONLY';

-- Backfill: if product has components, default to COMPONENTS_ONLY
UPDATE "Product" p
SET "stock_mode" = 'COMPONENTS_ONLY'
WHERE EXISTS (
  SELECT 1
  FROM "ProductComponent" pc
  WHERE pc.product_id = p.id
);

CREATE INDEX IF NOT EXISTS "Product_stock_mode_idx" ON "Product"("stock_mode");
