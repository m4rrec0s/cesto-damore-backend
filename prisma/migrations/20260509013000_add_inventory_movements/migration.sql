CREATE TABLE IF NOT EXISTS "InventoryMovement" (
  "id" TEXT NOT NULL,
  "product_id" TEXT,
  "item_id" TEXT,
  "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InventoryMovement_product_id_idx" ON "InventoryMovement"("product_id");
CREATE INDEX IF NOT EXISTS "InventoryMovement_item_id_idx" ON "InventoryMovement"("item_id");
CREATE INDEX IF NOT EXISTS "InventoryMovement_admin_id_idx" ON "InventoryMovement"("admin_id");
CREATE INDEX IF NOT EXISTS "InventoryMovement_created_at_idx" ON "InventoryMovement"("created_at");
CREATE INDEX IF NOT EXISTS "InventoryMovement_type_idx" ON "InventoryMovement"("type");

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
