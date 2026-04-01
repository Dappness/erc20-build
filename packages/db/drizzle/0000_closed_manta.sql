CREATE TABLE "holders" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"balance" numeric DEFAULT '0' NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"finalized_block" integer NOT NULL,
	"head_block" integer NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_state_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"name" varchar(255) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"decimals" integer DEFAULT 18 NOT NULL,
	"initial_supply" numeric NOT NULL,
	"cap" numeric,
	"minting_enabled" boolean DEFAULT false NOT NULL,
	"owner_address" varchar(42) NOT NULL,
	"source" varchar(10) NOT NULL,
	"deploy_tx_hash" varchar(66),
	"deploy_block" integer NOT NULL,
	"deployed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" integer NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"value" numeric NOT NULL,
	"is_finalized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holders" ADD CONSTRAINT "holders_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holders_token_address_idx" ON "holders" USING btree ("token_id","address");--> statement-breakpoint
CREATE INDEX "holders_token_balance_idx" ON "holders" USING btree ("token_id","balance");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_tx_log_idx" ON "transfers" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "transfers_token_block_idx" ON "transfers" USING btree ("token_id","block_number");--> statement-breakpoint
CREATE INDEX "transfers_token_finalized_idx" ON "transfers" USING btree ("token_id","is_finalized");--> statement-breakpoint
CREATE INDEX "transfers_token_from_idx" ON "transfers" USING btree ("token_id","from_address");--> statement-breakpoint
CREATE INDEX "transfers_token_to_idx" ON "transfers" USING btree ("token_id","to_address");