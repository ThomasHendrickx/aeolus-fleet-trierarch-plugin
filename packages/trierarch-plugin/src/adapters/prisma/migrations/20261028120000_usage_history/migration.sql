-- CreateTable
CREATE TABLE "usage_hours" (
    "fleet_id" TEXT NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "machine_ship_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "folder_made_at" TIMESTAMPTZ(3) NOT NULL,
    "model" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "login" TEXT,
    "input" BIGINT NOT NULL,
    "output" BIGINT NOT NULL,
    "cache_read" BIGINT NOT NULL,
    "cache_write" BIGINT NOT NULL,
    "estimated_cost_usd" DECIMAL(18,6),
    "read_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_hours_pkey" PRIMARY KEY ("fleet_id","hour","machine_ship_id","ship_id","folder_made_at","model")
);

-- CreateTable
CREATE TABLE "usage_days" (
    "id" BIGSERIAL NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "machine_ship_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "login" TEXT,
    "input" BIGINT NOT NULL,
    "output" BIGINT NOT NULL,
    "cache_read" BIGINT NOT NULL,
    "cache_write" BIGINT NOT NULL,
    "estimated_cost_usd" DECIMAL(18,6) NOT NULL,
    "unpriced_tokens" BIGINT NOT NULL,

    CONSTRAINT "usage_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_readings" (
    "fleet_id" TEXT NOT NULL,
    "machine_ship_id" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL,
    "used_percent" DECIMAL(5,2) NOT NULL,
    "resets_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_readings_pkey" PRIMARY KEY ("fleet_id","machine_ship_id","harness","window_minutes","read_at")
);

-- CreateIndex
-- NULLS NOT DISTINCT, written by hand: a login not reported is one key, not a new row each time.
CREATE UNIQUE INDEX "usage_days_fleet_id_day_machine_ship_id_ship_id_model_harne_key" ON "usage_days"("fleet_id", "day", "machine_ship_id", "ship_id", "model", "harness", "login") NULLS NOT DISTINCT;

