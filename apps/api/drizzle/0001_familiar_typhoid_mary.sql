CREATE TABLE "buyer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text NOT NULL,
	"pin" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"contact_phone" text,
	"contact_whatsapp" text,
	"agreement_version" text,
	"agreement_accepted_at" timestamp with time zone,
	"default_address_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_payment_profiles" (
	"seller_id" uuid PRIMARY KEY NOT NULL,
	"upi_id" text,
	"bank_holder" text,
	"bank_account" text,
	"bank_ifsc" text,
	"bank_name" text,
	"payment_link" text,
	"website" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"seller_type" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"area" text NOT NULL,
	"city" text NOT NULL,
	"gstin" text,
	"bio" text DEFAULT '' NOT NULL,
	"categories" text[] NOT NULL,
	"maps_url" text NOT NULL,
	"google_profile_url" text,
	"social_url" text,
	"contact_phone" text,
	"contact_whatsapp" text,
	"sla_confirm_hours" integer NOT NULL,
	"sla_ship_days" integer NOT NULL,
	"conduct_version" text,
	"conduct_accepted_at" timestamp with time zone,
	"verification" text DEFAULT 'UNVERIFIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "sellers_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"previous_refresh_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "buyer_addresses" ADD CONSTRAINT "buyer_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_profiles" ADD CONSTRAINT "buyer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_payment_profiles" ADD CONSTRAINT "seller_payment_profiles_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_addresses_user_idx" ON "buyer_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_app_idx" ON "sessions" USING btree ("user_id","app");--> statement-breakpoint
CREATE INDEX "sessions_previous_hash_idx" ON "sessions" USING btree ("previous_refresh_hash");