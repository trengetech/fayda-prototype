CREATE TABLE "notification_settings" (
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"category" text NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_settings_user_id_app_category_pk" PRIMARY KEY("user_id","app","category")
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;