CREATE TABLE "airlines" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"code" text NOT NULL,
	"status" text NOT NULL,
	"flight_id" text NOT NULL,
	"total_price" integer NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_code_unique" UNIQUE("code"),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" text PRIMARY KEY NOT NULL,
	"airline_code" text NOT NULL,
	"flight_number" text NOT NULL,
	"origin_code" text NOT NULL,
	"destination_code" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price" integer NOT NULL,
	"seats_available" integer NOT NULL,
	CONSTRAINT "flights_origin_ne_destination" CHECK ("flights"."origin_code" <> "flights"."destination_code")
);
--> statement-breakpoint
CREATE TABLE "passengers" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" text NOT NULL,
	"document_number" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_airline_code_airlines_code_fk" FOREIGN KEY ("airline_code") REFERENCES "public"."airlines"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_origin_code_cities_code_fk" FOREIGN KEY ("origin_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_destination_code_cities_code_fk" FOREIGN KEY ("destination_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_booking_id_bookings_code_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flights_search_idx" ON "flights" USING btree ("origin_code","destination_code","departure_at");