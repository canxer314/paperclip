CREATE TABLE "company_claude_host_access" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activity_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_claude_host_access" ADD CONSTRAINT "company_claude_host_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_claude_host_access" ADD CONSTRAINT "company_claude_host_access_activity_id_activity_log_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity_log"("id") ON DELETE no action ON UPDATE no action;