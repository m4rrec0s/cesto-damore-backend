-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTHORIZED', 'IN_PROCESS', 'IN_MEDIATION', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK');

-- AlterTable
ALTER TABLE "public"."Additional" ADD COLUMN     "discount" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "discount" DOUBLE PRECISION DEFAULT 0;

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

-- CreateIndex
CREATE UNIQUE INDEX "Payment_order_id_key" ON "public"."Payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mercado_pago_id_key" ON "public"."Payment"("mercado_pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSummary_date_key" ON "public"."FinancialSummary"("date");

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
