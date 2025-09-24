-- CreateEnum
CREATE TYPE "public"."FeedSectionType" AS ENUM ('RECOMMENDED_PRODUCTS', 'DISCOUNTED_PRODUCTS', 'FEATURED_CATEGORIES', 'FEATURED_ADDITIONALS', 'CUSTOM_PRODUCTS', 'NEW_ARRIVALS', 'BEST_SELLERS');

-- CreateTable
CREATE TABLE "public"."FeedConfiguration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "show_banners" BOOLEAN NOT NULL DEFAULT true,
    "show_recommended" BOOLEAN NOT NULL DEFAULT true,
    "show_discounted" BOOLEAN NOT NULL DEFAULT true,
    "show_categories" BOOLEAN NOT NULL DEFAULT true,
    "show_additionals" BOOLEAN NOT NULL DEFAULT true,
    "max_recommended" INTEGER NOT NULL DEFAULT 6,
    "max_discounted" INTEGER NOT NULL DEFAULT 4,
    "max_categories" INTEGER NOT NULL DEFAULT 8,
    "max_additionals" INTEGER NOT NULL DEFAULT 6,
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
    "button_text" TEXT,
    "button_url" TEXT,
    "background_color" TEXT DEFAULT '#FFFFFF',
    "text_color" TEXT DEFAULT '#000000',
    "button_color" TEXT DEFAULT '#007BFF',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
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
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "max_items" INTEGER NOT NULL DEFAULT 6,
    "show_view_all" BOOLEAN NOT NULL DEFAULT true,
    "view_all_url" TEXT,
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

-- AddForeignKey
ALTER TABLE "public"."FeedBanner" ADD CONSTRAINT "FeedBanner_feed_config_id_fkey" FOREIGN KEY ("feed_config_id") REFERENCES "public"."FeedConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeedSection" ADD CONSTRAINT "FeedSection_feed_config_id_fkey" FOREIGN KEY ("feed_config_id") REFERENCES "public"."FeedConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeedSectionItem" ADD CONSTRAINT "FeedSectionItem_feed_section_id_fkey" FOREIGN KEY ("feed_section_id") REFERENCES "public"."FeedSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
