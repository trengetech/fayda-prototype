CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "feed_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"scope" text NOT NULL,
	"ranker" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "rank_score" integer DEFAULT 4700 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "ranked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_impressions_created_idx" ON "feed_impressions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feed_impressions_listing_idx" ON "feed_impressions" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "listings_title_trgm_idx" ON "listings" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_description_trgm_idx" ON "listings" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_rank_idx" ON "listings" USING btree ("status","rank_score","id");