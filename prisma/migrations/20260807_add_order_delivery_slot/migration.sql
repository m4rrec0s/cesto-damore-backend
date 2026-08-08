ALTER TABLE "Order" ADD COLUMN "delivery_slot" TEXT;
ALTER TABLE "Order" ADD COLUMN "customization_whatsapp_sent_at" TIMESTAMP(3);

CREATE TABLE "OrderMetricSnapshot" (
  "id" TEXT NOT NULL,
  "order_ref" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "city" TEXT,
  "state" TEXT,
  "item_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderMetricSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderMetricSnapshot_order_ref_key" ON "OrderMetricSnapshot"("order_ref");
CREATE INDEX "OrderMetricSnapshot_created_at_idx" ON "OrderMetricSnapshot"("created_at");
CREATE INDEX "OrderMetricSnapshot_city_state_idx" ON "OrderMetricSnapshot"("city", "state");
