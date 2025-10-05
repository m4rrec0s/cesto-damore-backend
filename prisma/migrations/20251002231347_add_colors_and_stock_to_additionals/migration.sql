-- AlterTable
ALTER TABLE "public"."Additional" ADD COLUMN     "stock_quantity" INTEGER DEFAULT 0;

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
CREATE TABLE "public"."AdditionalColor" (
    "additional_id" TEXT NOT NULL,
    "color_id" TEXT NOT NULL,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalColor_pkey" PRIMARY KEY ("additional_id","color_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Colors_hex_code_key" ON "public"."Colors"("hex_code");

-- AddForeignKey
ALTER TABLE "public"."AdditionalColor" ADD CONSTRAINT "AdditionalColor_additional_id_fkey" FOREIGN KEY ("additional_id") REFERENCES "public"."Additional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdditionalColor" ADD CONSTRAINT "AdditionalColor_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "public"."Colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
