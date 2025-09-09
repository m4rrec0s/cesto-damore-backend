/*
  Warnings:

  - You are about to drop the column `compatible_with` on the `Additional` table. All the data in the column will be lost.
  - Added the required column `updated_at` to the `ProductAdditional` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Additional" DROP COLUMN "compatible_with";

-- AlterTable
ALTER TABLE "public"."ProductAdditional" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "custom_price" DOUBLE PRECISION,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;
