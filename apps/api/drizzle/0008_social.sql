CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"client_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "listing_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_listing_idx" ON "comments" USING btree ("listing_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_client_key_idx" ON "comments" USING btree ("author_user_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "likes_edge_idx" ON "likes" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "likes_target_idx" ON "likes" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saves_edge_idx" ON "saves" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "saves_target_idx" ON "saves" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "saves_person_idx" ON "saves" USING btree ("user_id","target_type","created_at","id");