-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "grand_total" DOUBLE PRECISION,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "shipping_price" DOUBLE PRECISION;
