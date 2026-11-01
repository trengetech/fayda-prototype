CREATE TABLE "push_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_tickets_ticket_idx" ON "push_tickets" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "push_tickets_created_idx" ON "push_tickets" USING btree ("created_at");