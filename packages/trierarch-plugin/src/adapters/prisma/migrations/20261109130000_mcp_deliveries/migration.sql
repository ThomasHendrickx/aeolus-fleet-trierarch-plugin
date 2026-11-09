-- CreateTable
CREATE TABLE "mcp_deliveries" (
    "fleet_id" TEXT NOT NULL,
    "trierarch_ship_id" TEXT NOT NULL,
    "attempt_version" INTEGER,
    "attempt_public_key" TEXT,
    "attempt_idempotency_key" TEXT,
    "attempt_payload" TEXT,
    "attempt_sent_at" TIMESTAMPTZ(3),
    "applied_version" INTEGER,
    "applied_public_key" TEXT,
    "is_requested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mcp_deliveries_pkey" PRIMARY KEY ("fleet_id","trierarch_ship_id")
);
