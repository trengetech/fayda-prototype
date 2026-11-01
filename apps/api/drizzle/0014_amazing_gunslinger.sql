CREATE TABLE "listing_rank_scores" (
	"generation" bigint NOT NULL,
	"listing_id" uuid NOT NULL,
	"score" integer NOT NULL,
	CONSTRAINT "listing_rank_scores_generation_listing_id_pk" PRIMARY KEY("generation","listing_id")
);
--> statement-breakpoint
DROP INDEX "listings_title_trgm_idx";--> statement-breakpoint
DROP INDEX "listings_description_trgm_idx";--> statement-breakpoint
DROP INDEX "listings_rank_idx";--> statement-breakpoint
ALTER TABLE "listing_rank_scores" ADD CONSTRAINT "listing_rank_scores_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_rank_scores_listing_idx" ON "listing_rank_scores" USING btree ("listing_id");--> statement-breakpoint
ALTER TABLE "listings" DROP COLUMN "rank_score";--> statement-breakpoint
ALTER TABLE "listings" DROP COLUMN "ranked_at";