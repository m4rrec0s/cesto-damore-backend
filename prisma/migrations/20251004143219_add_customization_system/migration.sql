-- CreateEnum
CREATE TYPE "public"."CustomizationType" AS ENUM ('PHOTO_UPLOAD', 'ITEM_SUBSTITUTION', 'TEXT_INPUT', 'MULTIPLE_CHOICE');

-- AlterTable
ALTER TABLE "public"."Additional" ADD COLUMN     "allows_customization" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "allows_customization" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."ProductCustomization" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customization_type" "public"."CustomizationType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "max_items" INTEGER DEFAULT 1,
    "available_options" TEXT,
    "preview_image_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdditionalCustomization" (
    "id" TEXT NOT NULL,
    "additional_id" TEXT NOT NULL,
    "customization_type" "public"."CustomizationType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "max_items" INTEGER DEFAULT 1,
    "available_options" TEXT,
    "preview_image_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItemCustomization" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "customization_rule_id" TEXT,
    "customization_type" "public"."CustomizationType" NOT NULL,
    "title" TEXT NOT NULL,
    "customization_data" TEXT NOT NULL,
    "google_drive_folder_id" TEXT,
    "google_drive_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItemCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemporaryCustomizationFile" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemporaryCustomizationFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemporaryCustomizationFile_session_id_idx" ON "public"."TemporaryCustomizationFile"("session_id");

-- CreateIndex
CREATE INDEX "TemporaryCustomizationFile_expires_at_idx" ON "public"."TemporaryCustomizationFile"("expires_at");

-- AddForeignKey
ALTER TABLE "public"."ProductCustomization" ADD CONSTRAINT "ProductCustomization_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdditionalCustomization" ADD CONSTRAINT "AdditionalCustomization_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "public"."Additional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItemCustomization" ADD CONSTRAINT "OrderItemCustomization_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
