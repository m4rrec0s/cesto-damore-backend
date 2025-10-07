-- AlterTable
ALTER TABLE "public"."ProductType" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'MODELO_PRONTO',
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "delivery_type" TEXT NOT NULL DEFAULT 'PRONTA_ENTREGA',
ADD COLUMN     "has_3d_preview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stock_quantity" INTEGER,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "public"."ProductRule" (
    "id" TEXT NOT NULL,
    "product_type_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "max_items" INTEGER,
    "conflict_with" TEXT,
    "dependencies" TEXT,
    "available_options" TEXT,
    "preview_image_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ItemConstraint" (
    "id" TEXT NOT NULL,
    "target_item_id" TEXT NOT NULL,
    "target_item_type" TEXT NOT NULL,
    "constraint_type" TEXT NOT NULL,
    "related_item_id" TEXT NOT NULL,
    "related_item_type" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductRule_product_type_id_idx" ON "public"."ProductRule"("product_type_id");

-- CreateIndex
CREATE INDEX "ItemConstraint_target_item_id_idx" ON "public"."ItemConstraint"("target_item_id");

-- CreateIndex
CREATE INDEX "ItemConstraint_related_item_id_idx" ON "public"."ItemConstraint"("related_item_id");

-- AddForeignKey
ALTER TABLE "public"."ProductRule" ADD CONSTRAINT "ProductRule_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."ProductType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
