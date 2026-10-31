CREATE TABLE "otp_attempts" (
	"phone" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"locked_until" timestamp with time zone
);
