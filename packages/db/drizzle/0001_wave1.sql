CREATE TYPE "public"."auth_token_type" AS ENUM('email_verify', 'password_reset', 'invite', 'totp_challenge');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_source" AS ENUM('checkout', 'autopay');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('pending', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_method_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."payment_webhook_event_status" AS ENUM('received', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provisioning_log_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."server_group_fill_type" AS ENUM('least_loaded', 'fill_first');--> statement-breakpoint
CREATE TYPE "public"."notification_level" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."unknown_sender_policy" AS ENUM('inherit', 'guest', 'reject');--> statement-breakpoint
ALTER TYPE "public"."domain_status" ADD VALUE 'pending_registration' BEFORE 'pending_transfer';--> statement-breakpoint
ALTER TYPE "public"."domain_status" ADD VALUE 'redemption' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."email_status" ADD VALUE 'bounced';--> statement-breakpoint
CREATE SEQUENCE "public"."ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"meta" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "credit_note_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" bigint NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"amount" bigint NOT NULL,
	"service_id" uuid,
	"domain_id" uuid,
	"period_start" date,
	"period_end" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"kind" varchar(20) NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_counters_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
CREATE TABLE "domain_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid,
	"severity" varchar(10) NOT NULL,
	"kind" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"label" varchar(100) DEFAULT 'Default' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"organization" varchar(200),
	"email" varchar(255) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"address1" varchar(200) NOT NULL,
	"address2" varchar(200),
	"city" varchar(100) NOT NULL,
	"postal_code" varchar(20) NOT NULL,
	"state" varchar(100),
	"country" varchar(2) NOT NULL,
	"registrar_handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_sync_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid,
	"job" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"transition" varchar(80),
	"message" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrar_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"module" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"config_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"pricing_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrar_accounts_module_unique" UNIQUE("module")
);
--> statement-breakpoint
CREATE TABLE "tld_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tld_id" uuid NOT NULL,
	"years" integer DEFAULT 1 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"register" bigint DEFAULT 0 NOT NULL,
	"renew" bigint DEFAULT 0 NOT NULL,
	"transfer" bigint DEFAULT 0 NOT NULL,
	"cost_register" bigint,
	"cost_renew" bigint,
	"cost_transfer" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tlds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tld" varchar(63) NOT NULL,
	"registrar_module" varchar(50),
	"enabled" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"min_years" integer DEFAULT 1 NOT NULL,
	"max_years" integer DEFAULT 10 NOT NULL,
	"epp_required" boolean DEFAULT true NOT NULL,
	"id_protection_supported" boolean DEFAULT false NOT NULL,
	"dns_management_supported" boolean DEFAULT false NOT NULL,
	"grace_period_days" integer DEFAULT 0 NOT NULL,
	"redemption_period_days" integer DEFAULT 30 NOT NULL,
	"redemption_fee" bigint DEFAULT 0 NOT NULL,
	"additional_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_payment_preferences" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"auto_pay" boolean DEFAULT false NOT NULL,
	"payment_method_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_gateways" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gateway_id" varchar(50) NOT NULL,
	"display_name" varchar(100),
	"enabled" boolean DEFAULT false NOT NULL,
	"config_encrypted" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"gateway" varchar(50) NOT NULL,
	"gateway_txn_id" varchar(255) NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"status" "payment_intent_status" DEFAULT 'pending' NOT NULL,
	"source" "payment_intent_source" DEFAULT 'checkout' NOT NULL,
	"payment_method_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"gateway" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"gateway_customer_id" varchar(255),
	"gateway_method_id" varchar(255) NOT NULL,
	"label" varchar(200) DEFAULT '' NOT NULL,
	"expires_at" varchar(10),
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "payment_method_status" DEFAULT 'active' NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gateway" varchar(50) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"event_type" varchar(100),
	"status" "payment_webhook_event_status" DEFAULT 'received' NOT NULL,
	"invoice_id" uuid,
	"txn_id" varchar(255),
	"result" jsonb,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provisioning_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid,
	"server_id" uuid,
	"action" varchar(50) NOT NULL,
	"status" "provisioning_log_status" NOT NULL,
	"message" text,
	"details" jsonb,
	"actor_user_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"fill_type" "server_group_fill_type" DEFAULT 'least_loaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "service_usage" (
	"service_id" uuid PRIMARY KEY NOT NULL,
	"disk_used_mb" real,
	"disk_limit_mb" real,
	"bandwidth_used_mb" real,
	"bandwidth_limit_mb" real,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid,
	"title" varchar(150) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"level" "notification_level" DEFAULT 'info' NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"link" varchar(500),
	"entity_type" varchar(50),
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"reply_id" uuid,
	"uploaded_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"path" varchar(500) NOT NULL,
	"size" integer NOT NULL,
	"mime_type" varchar(150) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_watchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_key_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scopes" jsonb DEFAULT '["*"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "remember_me" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "impersonator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "parent_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "reverse_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "tax_summary" jsonb;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "billing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "late_fee_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "dunning_suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "dunning_terminated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_summary" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "parent_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "vat_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "vat_check_result" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "registrar_status" varchar(50);--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "registrant_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "admin_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "tech_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "billing_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "expiry_notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "auto_renew_invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "status_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "status_ok" boolean;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "status_message" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "impersonator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "cc" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "from_email" varchar(255);--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "locale" varchar(10);--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "body_text" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "related_type" varchar(50);--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "related_id" uuid;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "locale" varchar(10) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "use_layout" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_departments" ADD COLUMN "imap_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_departments" ADD COLUMN "mailbox_config_encrypted" text;--> statement-breakpoint
ALTER TABLE "ticket_departments" ADD COLUMN "unknown_sender_policy" "unknown_sender_policy" DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_departments" ADD COLUMN "auto_close_days" integer;--> statement-breakpoint
ALTER TABLE "ticket_departments" ADD COLUMN "escalation_hours" integer;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD COLUMN "source" varchar(10) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "cc" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_reply_by" varchar(10);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "merged_into_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_alerts" ADD CONSTRAINT "domain_alerts_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_alerts" ADD CONSTRAINT "domain_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_contacts" ADD CONSTRAINT "domain_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_sync_log" ADD CONSTRAINT "domain_sync_log_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tld_prices" ADD CONSTRAINT "tld_prices_tld_id_tlds_id_fk" FOREIGN KEY ("tld_id") REFERENCES "public"."tlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payment_preferences" ADD CONSTRAINT "client_payment_preferences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payment_preferences" ADD CONSTRAINT "client_payment_preferences_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_log" ADD CONSTRAINT "provisioning_log_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_log" ADD CONSTRAINT "provisioning_log_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_log" ADD CONSTRAINT "provisioning_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_usage" ADD CONSTRAINT "service_usage_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_department_id_ticket_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."ticket_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_reply_id_ticket_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."ticket_replies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_idx" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_type_idx" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_idx" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "credit_note_items_note_idx" ON "credit_note_items" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX "domain_alerts_open_idx" ON "domain_alerts" USING btree ("acknowledged_at","created_at");--> statement-breakpoint
CREATE INDEX "domain_alerts_domain_idx" ON "domain_alerts" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "domain_contacts_client_idx" ON "domain_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "domain_sync_log_domain_idx" ON "domain_sync_log" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_sync_log_created_idx" ON "domain_sync_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tld_prices_unique_idx" ON "tld_prices" USING btree ("tld_id","years","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "tlds_tld_idx" ON "tlds" USING btree ("tld");--> statement-breakpoint
CREATE INDEX "tlds_registrar_idx" ON "tlds" USING btree ("registrar_module");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_gateways_gateway_idx" ON "payment_gateways" USING btree ("gateway_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_gateway_txn_idx" ON "payment_intents" USING btree ("gateway","gateway_txn_id");--> statement-breakpoint
CREATE INDEX "payment_intents_invoice_idx" ON "payment_intents" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_gateway_method_idx" ON "payment_methods" USING btree ("gateway","gateway_method_id");--> statement-breakpoint
CREATE INDEX "payment_methods_client_idx" ON "payment_methods" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_gateway_event_idx" ON "payment_webhook_events" USING btree ("gateway","event_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_invoice_idx" ON "payment_webhook_events" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "provisioning_log_service_idx" ON "provisioning_log" USING btree ("service_id","created_at");--> statement-breakpoint
CREATE INDEX "provisioning_log_server_idx" ON "provisioning_log" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ticket_attachments_ticket_idx" ON "ticket_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_attachments_reply_idx" ON "ticket_attachments" USING btree ("reply_id");--> statement-breakpoint
CREATE INDEX "ticket_notes_ticket_idx" ON "ticket_notes" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_watchers_unique_idx" ON "ticket_watchers" USING btree ("ticket_id","user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_registrant_contact_id_domain_contacts_id_fk" FOREIGN KEY ("registrant_contact_id") REFERENCES "public"."domain_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_admin_contact_id_domain_contacts_id_fk" FOREIGN KEY ("admin_contact_id") REFERENCES "public"."domain_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_tech_contact_id_domain_contacts_id_fk" FOREIGN KEY ("tech_contact_id") REFERENCES "public"."domain_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_billing_contact_id_domain_contacts_id_fk" FOREIGN KEY ("billing_contact_id") REFERENCES "public"."domain_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_service_period_idx" ON "invoice_items" USING btree ("service_id","period_start") WHERE service_id is not null and period_start is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_domain_period_idx" ON "invoice_items" USING btree ("domain_id","period_start") WHERE domain_id is not null and period_start is not null;--> statement-breakpoint
CREATE INDEX "domains_status_idx" ON "domains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "activity_log_action_idx" ON "activity_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "email_log_related_idx" ON "email_log" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX "email_log_status_idx" ON "email_log" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_key_locale_idx" ON "email_templates" USING btree ("key","locale");--> statement-breakpoint
CREATE INDEX "ticket_replies_message_id_idx" ON "ticket_replies" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "tickets_status_last_reply_idx" ON "tickets" USING btree ("status","last_reply_at");