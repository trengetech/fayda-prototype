CREATE TABLE "listing_media" (
	"listing_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_id" uuid NOT NULL,
	"poster_media_id" uuid,
	CONSTRAINT "listing_media_listing_id_position_pk" PRIMARY KEY("listing_id","position")
);
--> statement-breakpoint
CREATE TABLE "listing_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"stock" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"price_paise" integer NOT NULL,
	"bargain_mode" text NOT NULL,
	"expiry_hours" integer NOT NULL,
	"channel" text NOT NULL,
	"product_url" text,
	"auto_accept_at" integer,
	"auto_decline_below" integer,
	"auto_counter_at" integer,
	"deal_accept" jsonb,
	"deal_counter" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"mime" text NOT NULL,
	"declared_size" integer NOT NULL,
	"size" integer,
	"duration_sec" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"adapter" text NOT NULL,
	"storage_key" text NOT NULL,
	"upload_token_hash" text,
	"upload_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "seller_payment_profiles" ADD COLUMN "upi_qr_media_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_poster_media_id_media_id_fk" FOREIGN KEY ("poster_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_media_media_idx" ON "listing_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "listing_variants_listing_idx" ON "listing_variants" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listings_seller_idx" ON "listings" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "listings_feed_idx" ON "listings" USING btree ("status","published_at","id");--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "media_status_created_idx" ON "media" USING btree ("status","created_at");