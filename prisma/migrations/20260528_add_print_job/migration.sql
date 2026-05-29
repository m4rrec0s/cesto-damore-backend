-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTHORIZED', 'IN_PROCESS', 'IN_MEDIATION', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "FeedSectionType" AS ENUM ('RECOMMENDED_PRODUCTS', 'DISCOUNTED_PRODUCTS', 'FEATURED_CATEGORIES', 'FEATURED_ADDITIONALS', 'CUSTOM_PRODUCTS', 'NEW_ARRIVALS', 'BEST_SELLERS');

-- CreateEnum
CREATE TYPE "CustomizationType" AS ENUM ('DYNAMIC_LAYOUT', 'TEXT', 'IMAGES', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "TrendStatType" AS ENUM ('PRODUCT_VIEW', 'PRODUCT_SALE', 'LAYOUT_VIEW', 'ACCESS');

-- CreateEnum
CREATE TYPE "TrendEntityType" AS ENUM ('PRODUCT', 'LAYOUT', 'REGION', 'IP');

-- CreateEnum
CREATE TYPE "TrendPeriodType" AS ENUM ('DAILY', 'ROLLING_30D');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'PRINTING', 'PRINTED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
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
    "document" TEXT,
    "two_factor_code" TEXT,
    "two_factor_expires_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "stock_quantity" INTEGER,
    "stock_mode" TEXT NOT NULL DEFAULT 'PRODUCT_ONLY',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "allows_customization" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "type_id" TEXT NOT NULL,
    "production_time" INTEGER DEFAULT 0,
    "embedding" vector,
    "embedding_generated_at" TIMESTAMP(6),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "product_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("product_id","category_id")
);

-- CreateTable
CREATE TABLE "ProductAdditional" (
    "product_id" TEXT NOT NULL,
    "additional_id" TEXT NOT NULL,
    "custom_price" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAdditional_pkey" PRIMARY KEY ("product_id","additional_id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pending_owner_key" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_price" DOUBLE PRECISION NOT NULL,
    "delivery_address" TEXT,
    "delivery_date" TIMESTAMP(3),
    "shipping_price" DOUBLE PRECISION,
    "payment_method" TEXT,
    "grand_total" DOUBLE PRECISION,
    "recipient_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "complement" TEXT,
    "send_anonymously" BOOLEAN DEFAULT false,
    "delivery_city" TEXT,
    "delivery_state" TEXT,
    "customizations_drive_processed" BOOLEAN NOT NULL DEFAULT false,
    "customizations_drive_processed_at" TIMESTAMP(3),
    "confirmation_whatsapp_sent_at" TIMESTAMP(3),
    "google_drive_folder_id" TEXT,
    "google_drive_folder_url" TEXT,
    "delivery_method" TEXT DEFAULT 'delivery',

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemAdditional" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "additional_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItemAdditional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_job_order" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "filesJson" TEXT NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_job_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "mercado_pago_id" TEXT,
    "preference_id" TEXT,
    "payment_method" TEXT,
    "payment_type" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT,
    "topic" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "raw_data" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalization_attempts" INTEGER NOT NULL DEFAULT 0,
    "finalization_succeeded" BOOLEAN DEFAULT false,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservationItem" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "product_id" TEXT,
    "item_id" TEXT,
    "quantity_reserved" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,

    CONSTRAINT "StockReservationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedConfiguration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedBanner" (
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
CREATE TABLE "FeedSection" (
    "id" TEXT NOT NULL,
    "feed_config_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section_type" "FeedSectionType" NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "max_items" INTEGER NOT NULL DEFAULT 6,

    CONSTRAINT "FeedSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedSectionItem" (
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
CREATE TABLE "LayoutBase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "slots" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "additional_time" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LayoutBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'outros',
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "base_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "image_url" TEXT,
    "allows_customization" BOOLEAN NOT NULL DEFAULT false,
    "layout_base_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "dynamic_layout_id" TEXT,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
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

-- CreateTable
CREATE TABLE "Customization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "item_id" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "type" "CustomizationType" NOT NULL,
    "customization_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductComponent" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemCustomization" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "customization_id" TEXT,
    "value" TEXT NOT NULL,
    "google_drive_folder_id" TEXT,
    "google_drive_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "additional_time_hours" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItemCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAgentSession" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "customer_phone" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "remote_jid_alt" TEXT,

    CONSTRAINT "AIAgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAgentMessage" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "name" TEXT,
    "tool_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tool_calls" TEXT,
    "sent_to_client" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AIAgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMemory" (
    "id" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "extracted_text" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page_number" INTEGER,
    "text_content" TEXT NOT NULL,
    "token_estimate" INTEGER NOT NULL DEFAULT 0,
    "embedding" JSONB NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "n8n_vectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,

    CONSTRAINT "n8n_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "closure_type" TEXT NOT NULL DEFAULT 'full_day',
    "duration_hours" INTEGER,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISessionProductHistory" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 1,
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISessionProductHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISummary" (
    "id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "number" TEXT NOT NULL,
    "name" TEXT,
    "last_message_sent" TIMESTAMP(3),
    "service_status" TEXT,
    "already_a_customer" BOOLEAN NOT NULL DEFAULT false,
    "follow_up" BOOLEAN NOT NULL DEFAULT false,
    "remote_jid_alt" TEXT,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "followup_enviados" (
    "id" TEXT NOT NULL,
    "cliente_number" TEXT NOT NULL,
    "horas_followup" INTEGER NOT NULL,
    "enviado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_enviados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "userId" TEXT,
    "orderId" TEXT,
    "clientIp" TEXT,

    CONSTRAINT "TempUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseImageUrl" TEXT NOT NULL,
    "fabricJsonState" JSONB NOT NULL,
    "previewImageUrl" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedLayoutBaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productionTime" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DynamicLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicLayoutVersion" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fabricJsonState" JSONB NOT NULL,
    "changedBy" TEXT,
    "changeDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DynamicLayoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicLayoutElement" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "elementType" TEXT NOT NULL,
    "fabricObjectId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "order" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DynamicLayoutElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementBank" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "width" INTEGER,
    "height" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'local',
    "externalId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElementBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendStat" (
    "id" TEXT NOT NULL,
    "stat_type" "TrendStatType" NOT NULL,
    "entity_type" "TrendEntityType" NOT NULL,
    "entity_key" TEXT NOT NULL,
    "period_type" "TrendPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "scope_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbeddingCache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "embedding_type" TEXT NOT NULL,
    "embedding_hash" TEXT NOT NULL,
    "product_id" TEXT,
    "text_content" TEXT,
    "model" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbeddingCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "n8n_chat_histories" (
    "id" SERIAL NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "message" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "n8n_chat_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_prompt_overrides" (
    "id" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL DEFAULT '',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_permanent" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_prompt_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_prompt_priority_instructions" (
    "id" SERIAL NOT NULL,
    "prompt_text" TEXT NOT NULL DEFAULT '',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_permanent" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_keywords" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "llm_prompt_priority_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotFlow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_knowledge_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phases" TEXT[],
    "tags" TEXT[],
    "pattern_type" TEXT,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approval_status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "embedding_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_embeddings" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "vector" TEXT,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_knowledge_profiles" (
    "id" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "learnings" TEXT NOT NULL,
    "preferred_phrases" TEXT[],
    "common_objections" TEXT[],
    "success_patterns" TEXT[],
    "last_updated_by" TEXT NOT NULL,
    "auto_updates" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_knowledge_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "current_node_id" TEXT,
    "is_human" BOOLEAN NOT NULL DEFAULT false,
    "state" JSONB,
    "history" JSONB DEFAULT '[]',
    "dynamic_menu" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUId_key" ON "User"("firebaseUId");

-- CreateIndex
CREATE INDEX "idx_product_embedding" ON "Product"("embedding");

-- CreateIndex
CREATE INDEX "product_embedding_idx" ON "Product"("embedding");

-- CreateIndex
CREATE UNIQUE INDEX "Order_pending_owner_key_key" ON "Order"("pending_owner_key");

-- CreateIndex
CREATE UNIQUE INDEX "print_job_order_orderId_key" ON "print_job_order"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_order_id_key" ON "Payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mercado_pago_id_key" ON "Payment"("mercado_pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_order_id_key" ON "StockReservation"("order_id");

-- CreateIndex
CREATE INDEX "StockReservation_status_expires_at_idx" ON "StockReservation"("status", "expires_at");

-- CreateIndex
CREATE INDEX "StockReservation_order_id_idx" ON "StockReservation"("order_id");

-- CreateIndex
CREATE INDEX "StockReservation_expires_at_idx" ON "StockReservation"("expires_at");

-- CreateIndex
CREATE INDEX "StockReservationItem_reservation_id_idx" ON "StockReservationItem"("reservation_id");

-- CreateIndex
CREATE INDEX "StockReservationItem_product_id_idx" ON "StockReservationItem"("product_id");

-- CreateIndex
CREATE INDEX "StockReservationItem_item_id_idx" ON "StockReservationItem"("item_id");

-- CreateIndex
CREATE INDEX "InventoryMovement_product_id_idx" ON "InventoryMovement"("product_id");

-- CreateIndex
CREATE INDEX "InventoryMovement_item_id_idx" ON "InventoryMovement"("item_id");

-- CreateIndex
CREATE INDEX "InventoryMovement_admin_id_idx" ON "InventoryMovement"("admin_id");

-- CreateIndex
CREATE INDEX "InventoryMovement_created_at_idx" ON "InventoryMovement"("created_at");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_idx" ON "InventoryMovement"("type");

-- CreateIndex
CREATE INDEX "ProductComponent_product_id_idx" ON "ProductComponent"("product_id");

-- CreateIndex
CREATE INDEX "ProductComponent_item_id_idx" ON "ProductComponent"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductComponent_product_id_item_id_key" ON "ProductComponent"("product_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemCustomization_order_item_id_customization_id_key" ON "OrderItemCustomization"("order_item_id", "customization_id");

-- CreateIndex
CREATE UNIQUE INDEX "AIAgentSession_customer_phone_key" ON "AIAgentSession"("customer_phone");

-- CreateIndex
CREATE INDEX "AIAgentSession_remote_jid_alt_idx" ON "AIAgentSession"("remote_jid_alt");

-- CreateIndex
CREATE INDEX "AIAgentMessage_session_id_idx" ON "AIAgentMessage"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMemory_customer_phone_key" ON "CustomerMemory"("customer_phone");

-- CreateIndex
CREATE INDEX "knowledge_documents_status_updated_at_idx" ON "knowledge_documents"("status", "updated_at");

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_chunk_index_idx" ON "knowledge_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "knowledge_chunks_content_hash_idx" ON "knowledge_chunks"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key" ON "knowledge_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "Holiday_start_date_idx" ON "Holiday"("start_date");

-- CreateIndex
CREATE INDEX "AISessionProductHistory_session_id_idx" ON "AISessionProductHistory"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "AISessionProductHistory_session_id_product_id_key" ON "AISessionProductHistory"("session_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "followup_enviados_cliente_number_horas_followup_key" ON "followup_enviados"("cliente_number", "horas_followup");

-- CreateIndex
CREATE UNIQUE INDEX "TempUpload_filename_key" ON "TempUpload"("filename");

-- CreateIndex
CREATE INDEX "TempUpload_expiresAt_idx" ON "TempUpload"("expiresAt");

-- CreateIndex
CREATE INDEX "TempUpload_userId_idx" ON "TempUpload"("userId");

-- CreateIndex
CREATE INDEX "TempUpload_orderId_idx" ON "TempUpload"("orderId");

-- CreateIndex
CREATE INDEX "TempUpload_deletedAt_idx" ON "TempUpload"("deletedAt");

-- CreateIndex
CREATE INDEX "DynamicLayout_userId_idx" ON "DynamicLayout"("userId");

-- CreateIndex
CREATE INDEX "DynamicLayout_type_idx" ON "DynamicLayout"("type");

-- CreateIndex
CREATE INDEX "DynamicLayout_createdAt_idx" ON "DynamicLayout"("createdAt");

-- CreateIndex
CREATE INDEX "DynamicLayout_isPublished_idx" ON "DynamicLayout"("isPublished");

-- CreateIndex
CREATE INDEX "DynamicLayoutVersion_layoutId_idx" ON "DynamicLayoutVersion"("layoutId");

-- CreateIndex
CREATE UNIQUE INDEX "DynamicLayoutVersion_layoutId_versionNumber_key" ON "DynamicLayoutVersion"("layoutId", "versionNumber");

-- CreateIndex
CREATE INDEX "DynamicLayoutElement_layoutId_idx" ON "DynamicLayoutElement"("layoutId");

-- CreateIndex
CREATE INDEX "ElementBank_category_idx" ON "ElementBank"("category");

-- CreateIndex
CREATE INDEX "ElementBank_isActive_idx" ON "ElementBank"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TrendStat_scope_key_key" ON "TrendStat"("scope_key");

-- CreateIndex
CREATE INDEX "TrendStat_stat_type_entity_type_period_type_period_start_idx" ON "TrendStat"("stat_type", "entity_type", "period_type", "period_start");

-- CreateIndex
CREATE INDEX "embeddingcache_type_hash_idx" ON "EmbeddingCache"("embedding_type", "embedding_hash");

-- CreateIndex
CREATE UNIQUE INDEX "EmbeddingCache_embedding_type_embedding_hash_key" ON "EmbeddingCache"("embedding_type", "embedding_hash");

-- CreateIndex
CREATE INDEX "kb_knowledge_documents_category_idx" ON "kb_knowledge_documents"("category");

-- CreateIndex
CREATE INDEX "kb_knowledge_documents_approval_status_idx" ON "kb_knowledge_documents"("approval_status");

-- CreateIndex
CREATE INDEX "kb_knowledge_documents_phases_idx" ON "kb_knowledge_documents"("phases");

-- CreateIndex
CREATE INDEX "kb_versions_document_id_idx" ON "kb_versions"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "kb_versions_document_id_version_key" ON "kb_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "kb_embeddings_document_id_idx" ON "kb_embeddings"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_knowledge_profiles_customer_phone_key" ON "customer_knowledge_profiles"("customer_phone");

-- CreateIndex
CREATE INDEX "customer_knowledge_profiles_customer_phone_idx" ON "customer_knowledge_profiles"("customer_phone");

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_phone_key" ON "BotSession"("phone");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAdditional" ADD CONSTRAINT "ProductAdditional_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAdditional" ADD CONSTRAINT "ProductAdditional_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAdditional" ADD CONSTRAINT "OrderItemAdditional_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAdditional" ADD CONSTRAINT "OrderItemAdditional_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_job_order" ADD CONSTRAINT "print_job_order_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservationItem" ADD CONSTRAINT "StockReservationItem_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "StockReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservationItem" ADD CONSTRAINT "StockReservationItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservationItem" ADD CONSTRAINT "StockReservationItem_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedBanner" ADD CONSTRAINT "FeedBanner_feed_config_id_fkey" FOREIGN KEY ("feed_config_id") REFERENCES "FeedConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedSection" ADD CONSTRAINT "FeedSection_feed_config_id_fkey" FOREIGN KEY ("feed_config_id") REFERENCES "FeedConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedSectionItem" ADD CONSTRAINT "FeedSectionItem_feed_section_id_fkey" FOREIGN KEY ("feed_section_id") REFERENCES "FeedSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_dynamic_layout_id_fkey" FOREIGN KEY ("dynamic_layout_id") REFERENCES "DynamicLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_layout_base_id_fkey" FOREIGN KEY ("layout_base_id") REFERENCES "LayoutBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customization" ADD CONSTRAINT "Customization_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCustomization" ADD CONSTRAINT "OrderItemCustomization_customization_id_fkey" FOREIGN KEY ("customization_id") REFERENCES "Customization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCustomization" ADD CONSTRAINT "OrderItemCustomization_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgentMessage" ADD CONSTRAINT "AIAgentMessage_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AIAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_enviados" ADD CONSTRAINT "followup_enviados_cliente_number_fkey" FOREIGN KEY ("cliente_number") REFERENCES "clientes"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempUpload" ADD CONSTRAINT "TempUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynamicLayout" ADD CONSTRAINT "DynamicLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynamicLayoutVersion" ADD CONSTRAINT "DynamicLayoutVersion_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "DynamicLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynamicLayoutElement" ADD CONSTRAINT "DynamicLayoutElement_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "DynamicLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_versions" ADD CONSTRAINT "kb_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "kb_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_embeddings" ADD CONSTRAINT "kb_embeddings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "kb_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "BotFlow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

