CREATE TABLE "buyer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"size" text,
	"budget_paise" integer,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reached_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"from" text NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"media_id" uuid,
	"listing_id" uuid,
	"client_key" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"request_id" uuid,
	"response_id" uuid,
	"buyer_user_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"buyer_read_at" timestamp with time zone NOT NULL,
	"seller_read_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "orders_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1),
	"buyer_user_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"variant_label" text NOT NULL,
	"listing_title" text NOT NULL,
	"cover_media_id" uuid,
	"price_paise" integer NOT NULL,
	"list_price_paise" integer NOT NULL,
	"price_source" text NOT NULL,
	"negotiation_id" uuid,
	"channel" text NOT NULL,
	"payment_method" text,
	"deal_access" jsonb,
	"address" jsonb,
	"status" text NOT NULL,
	"confirm_by" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"shipment" jsonb,
	"cancel_reason" text,
	"cancel_note" text,
	"restocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_media" (
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "request_media_request_id_position_pk" PRIMARY KEY("request_id","position")
);
--> statement-breakpoint
CREATE TABLE "request_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"text" text,
	"price_paise" integer,
	"status" text NOT NULL,
	"thread_id" uuid,
	"listing_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_media" (
	"response_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "response_media_response_id_position_pk" PRIMARY KEY("response_id","position")
);
--> statement-breakpoint
CREATE TABLE "review_media" (
	"review_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "review_media_review_id_position_pk" PRIMARY KEY("review_id","position")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "buyer_requests" ADD CONSTRAINT "buyer_requests_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_media" ADD CONSTRAINT "request_media_request_id_buyer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."buyer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_media" ADD CONSTRAINT "request_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_responses" ADD CONSTRAINT "request_responses_request_id_buyer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."buyer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_responses" ADD CONSTRAINT "request_responses_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_media" ADD CONSTRAINT "response_media_response_id_request_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."request_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_media" ADD CONSTRAINT "response_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_requests_buyer_idx" ON "buyer_requests" USING btree ("buyer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "buyer_requests_open_idx" ON "buyer_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "buyer_requests_category_idx" ON "buyer_requests" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_client_key_idx" ON "chat_messages" USING btree ("thread_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_order_idx" ON "chat_threads" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_response_idx" ON "chat_threads" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "chat_threads_buyer_idx" ON "chat_threads" USING btree ("buyer_user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_threads_seller_idx" ON "chat_threads" USING btree ("seller_user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_confirm_due_idx" ON "orders" USING btree ("status","confirm_by");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_seq_idx" ON "orders" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_negotiation_idx" ON "orders" USING btree ("negotiation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_responses_seller_idx" ON "request_responses" USING btree ("request_id","seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_idx" ON "reviews" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reviews_seller_idx" ON "reviews" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_listing_idx" ON "reviews" USING btree ("listing_id");