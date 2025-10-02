/*
  Warnings:

  - You are about to drop the column `background_color` on the `FeedBanner` table. All the data in the column will be lost.
  - You are about to drop the column `button_color` on the `FeedBanner` table. All the data in the column will be lost.
  - You are about to drop the column `button_text` on the `FeedBanner` table. All the data in the column will be lost.
  - You are about to drop the column `button_url` on the `FeedBanner` table. All the data in the column will be lost.
  - You are about to drop the column `end_date` on the `FeedBanner` table. All the data in the column will be lost.
  - You are about to drop the column `start_date` on the `FeedBanner` table. All the data in the column will be lost.
  - You are about to drop the column `max_additionals` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `max_categories` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `max_discounted` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `max_recommended` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `show_additionals` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `show_banners` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `show_categories` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `show_discounted` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `show_recommended` on the `FeedConfiguration` table. All the data in the column will be lost.
  - You are about to drop the column `is_active` on the `FeedSection` table. All the data in the column will be lost.
  - You are about to drop the column `show_view_all` on the `FeedSection` table. All the data in the column will be lost.
  - You are about to drop the column `view_all_url` on the `FeedSection` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."FeedBanner" DROP COLUMN "background_color",
DROP COLUMN "button_color",
DROP COLUMN "button_text",
DROP COLUMN "button_url",
DROP COLUMN "end_date",
DROP COLUMN "start_date",
ADD COLUMN     "link_url" TEXT,
ALTER COLUMN "text_color" SET DEFAULT '#FFFFFF';

-- AlterTable
ALTER TABLE "public"."FeedConfiguration" DROP COLUMN "max_additionals",
DROP COLUMN "max_categories",
DROP COLUMN "max_discounted",
DROP COLUMN "max_recommended",
DROP COLUMN "show_additionals",
DROP COLUMN "show_banners",
DROP COLUMN "show_categories",
DROP COLUMN "show_discounted",
DROP COLUMN "show_recommended";

-- AlterTable
ALTER TABLE "public"."FeedSection" DROP COLUMN "is_active",
DROP COLUMN "show_view_all",
DROP COLUMN "view_all_url",
ADD COLUMN     "is_visible" BOOLEAN NOT NULL DEFAULT true;
