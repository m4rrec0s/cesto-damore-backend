-- Create StockReservation table
CREATE TABLE IF NOT EXISTS "StockReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL UNIQUE,
  "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "released_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'active',

  CONSTRAINT "StockReservation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order" ("id") ON DELETE CASCADE
);

-- Create StockReservationItem table
CREATE TABLE IF NOT EXISTS "StockReservationItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reservation_id" TEXT NOT NULL,
  "product_id" TEXT,
  "item_id" TEXT,
  "quantity_reserved" INTEGER NOT NULL,
  "item_type" TEXT NOT NULL,

  CONSTRAINT "StockReservationItem_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "StockReservation" ("id") ON DELETE CASCADE,
  CONSTRAINT "StockReservationItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product" ("id") ON DELETE SET NULL,
  CONSTRAINT "StockReservationItem_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item" ("id") ON DELETE SET NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "StockReservation_status_expires_at_idx" ON "StockReservation"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "StockReservation_order_id_idx" ON "StockReservation"("order_id");
CREATE INDEX IF NOT EXISTS "StockReservation_expires_at_idx" ON "StockReservation"("expires_at");

CREATE INDEX IF NOT EXISTS "StockReservationItem_reservation_id_idx" ON "StockReservationItem"("reservation_id");
CREATE INDEX IF NOT EXISTS "StockReservationItem_product_id_idx" ON "StockReservationItem"("product_id");
CREATE INDEX IF NOT EXISTS "StockReservationItem_item_id_idx" ON "StockReservationItem"("item_id");
