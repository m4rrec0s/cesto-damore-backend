/*
  Warnings:

  - Added the required column `related_item_type` to the `ItemConstraint` table without a default value. This is not possible if the table is not empty.
  - Added the required column `target_item_type` to the `ItemConstraint` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."ItemConstraint" ADD COLUMN     "related_item_name" TEXT,
ADD COLUMN     "related_item_type" TEXT NOT NULL,
ADD COLUMN     "target_item_name" TEXT,
ADD COLUMN     "target_item_type" TEXT NOT NULL;

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
CREATE TABLE "public"."TemporaryCustomizationFile" (
    "id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "TemporaryCustomizationFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductRule_product_type_id_idx" ON "public"."ProductRule"("product_type_id");

-- AddForeignKey
ALTER TABLE "public"."ProductRule" ADD CONSTRAINT "ProductRule_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."ProductType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
