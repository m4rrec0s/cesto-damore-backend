-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTHORIZED', 'IN_PROCESS', 'IN_MEDIATION', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."FeedSectionType" AS ENUM ('RECOMMENDED_PRODUCTS', 'DISCOUNTED_PRODUCTS', 'FEATURED_CATEGORIES', 'FEATURED_ADDITIONALS', 'CUSTOM_PRODUCTS', 'NEW_ARRIVALS', 'BEST_SELLERS');

-- CreateEnum
CREATE TYPE "public"."CustomizationType" AS ENUM ('BASE_LAYOUT', 'TEXT', 'IMAGES', 'MULTIPLE_CHOICE');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firebaseUId" TEXT,
    "image_url" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "role" TEXT NOT NULL DEFAULT 'client',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "stock_quantity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "allows_customization" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "type_id" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MODELO_PRONTO',
    "delivery_type" TEXT NOT NULL DEFAULT 'PRONTA_ENTREGA',
    "stock_quantity" INTEGER,
    "has_3d_preview" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductCategory" (
    "product_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("product_id","category_id")
);

-- CreateTable
CREATE TABLE "public"."Colors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Additional" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "image_url" TEXT,
    "stock_quantity" INTEGER DEFAULT 0,
    "allows_customization" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Additional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdditionalColor" (
    "additional_id" TEXT NOT NULL,
    "color_id" TEXT NOT NULL,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalColor_pkey" PRIMARY KEY ("additional_id","color_id")
);

-- CreateTable
CREATE TABLE "public"."ProductAdditional" (
    "product_id" TEXT NOT NULL,
    "additional_id" TEXT NOT NULL,
    "custom_price" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAdditional_pkey" PRIMARY KEY ("product_id","additional_id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_price" DOUBLE PRECISION NOT NULL,
    "delivery_address" TEXT,
    "delivery_date" TIMESTAMP(3),
    "shipping_price" DOUBLE PRECISION,
    "payment_method" TEXT,
    "grand_total" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItemAdditional" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "additional_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItemAdditional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "mercado_pago_id" TEXT,
    "preference_id" TEXT,
    "payment_method" TEXT,
    "payment_type" TEXT,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transaction_amount" DOUBLE PRECISION NOT NULL,
    "net_received_amount" DOUBLE PRECISION,
    "fee_details" TEXT,
    "external_reference" TEXT,
    "webhook_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_webhook_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FinancialSummary" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_net_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "approved_orders" INTEGER NOT NULL DEFAULT 0,
    "canceled_orders" INTEGER NOT NULL DEFAULT 0,
    "pending_orders" INTEGER NOT NULL DEFAULT 0,
    "total_products_sold" INTEGER NOT NULL DEFAULT 0,
    "total_additionals_sold" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookLog" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT,
    "topic" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "raw_data" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeedConfiguration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeedBanner" (
    "id" TEXT NOT NULL,
    "feed_config_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "image_url" TEXT NOT NULL,
    "link_url" TEXT,
    "text_color" TEXT DEFAULT '#FFFFFF',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeedSection" (
    "id" TEXT NOT NULL,
    "feed_config_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section_type" "public"."FeedSectionType" NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeedSectionItem" (
    "id" TEXT NOT NULL,
    "feed_section_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "custom_title" TEXT,
    "custom_subtitle" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedSectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "base_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "allows_customization" BOOLEAN NOT NULL DEFAULT false,
    "additional_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "item_id" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "type" "public"."CustomizationType" NOT NULL,
    "customization_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Layout" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "layout_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ItemConstraint" (
    "id" TEXT NOT NULL,
    "target_item_id" TEXT NOT NULL,
    "related_item_id" TEXT NOT NULL,
    "constraint_type" TEXT NOT NULL DEFAULT 'REQUIRES',
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductComponent" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItemCustomization" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "customization_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItemCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUId_key" ON "public"."User"("firebaseUId");

-- CreateIndex
CREATE UNIQUE INDEX "Colors_hex_code_key" ON "public"."Colors"("hex_code");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_order_id_key" ON "public"."Payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mercado_pago_id_key" ON "public"."Payment"("mercado_pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSummary_date_key" ON "public"."FinancialSummary"("date");

-- CreateIndex
CREATE INDEX "Layout_item_id_idx" ON "public"."Layout"("item_id");

-- CreateIndex
CREATE INDEX "ItemConstraint_target_item_id_idx" ON "public"."ItemConstraint"("target_item_id");

-- CreateIndex
CREATE INDEX "ItemConstraint_related_item_id_idx" ON "public"."ItemConstraint"("related_item_id");

-- CreateIndex
CREATE INDEX "ProductComponent_product_id_idx" ON "public"."ProductComponent"("product_id");

-- CreateIndex
CREATE INDEX "ProductComponent_item_id_idx" ON "public"."ProductComponent"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductComponent_product_id_item_id_key" ON "public"."ProductComponent"("product_id", "item_id");

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductCategory" ADD CONSTRAINT "ProductCategory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductCategory" ADD CONSTRAINT "ProductCategory_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdditionalColor" ADD CONSTRAINT "AdditionalColor_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "public"."Additional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdditionalColor" ADD CONSTRAINT "AdditionalColor_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "public"."Colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAdditional" ADD CONSTRAINT "ProductAdditional_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAdditional" ADD CONSTRAINT "ProductAdditional_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "public"."Additional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItemAdditional" ADD CONSTRAINT "OrderItemAdditional_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItemAdditional" ADD CONSTRAINT "OrderItemAdditional_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "public"."Additional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeedBanner" ADD CONSTRAINT "FeedBanner_feed_config_id_fkey" FOREIGN KEY ("feed_config_id") REFERENCES "public"."FeedConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeedSection" ADD CONSTRAINT "FeedSection_feed_config_id_fkey" FOREIGN KEY ("feed_config_id") REFERENCES "public"."FeedConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeedSectionItem" ADD CONSTRAINT "FeedSectionItem_feed_section_id_fkey" FOREIGN KEY ("feed_section_id") REFERENCES "public"."FeedSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Item" ADD CONSTRAINT "Item_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "public"."Additional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customization" ADD CONSTRAINT "Customization_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductComponent" ADD CONSTRAINT "ProductComponent_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductComponent" ADD CONSTRAINT "ProductComponent_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItemCustomization" ADD CONSTRAINT "OrderItemCustomization_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItemCustomization" ADD CONSTRAINT "OrderItemCustomization_customization_id_fkey" FOREIGN KEY ("customization_id") REFERENCES "public"."Customization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
