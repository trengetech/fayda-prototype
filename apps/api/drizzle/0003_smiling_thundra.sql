CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" text NOT NULL,
	"close_reason" text,
	"offers" jsonb NOT NULL,
	"events" jsonb NOT NULL,
	"agreement" jsonb,
	"next_due_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"code" text NOT NULL,
	"params" jsonb,
	"negotiation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "expiry_hours" SET DEFAULT 24;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "expiry_minutes" integer DEFAULT 1440 NOT NULL;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "negotiations_buyer_idx" ON "negotiations" USING btree ("buyer_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "negotiations_seller_idx" ON "negotiations" USING btree ("seller_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "negotiations_listing_idx" ON "negotiations" USING btree ("listing_id","status");--> statement-breakpoint
CREATE INDEX "negotiations_due_idx" ON "negotiations" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","app","created_at");--> statement-breakpoint
CREATE INDEX "reservations_variant_idx" ON "reservations" USING btree ("variant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "reservations_negotiation_idx" ON "reservations" USING btree ("negotiation_id");--> statement-breakpoint
UPDATE "listings" SET "bargain_mode" = CASE WHEN "bargain_mode" = 'FIXED' THEN 'BUY_NOW' ELSE 'BOTH' END;
