-- CreateTable
CREATE TABLE "connections" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "ship_name" TEXT NOT NULL,
    "crew_token" TEXT,
    "crewed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("fleet_id")
);

-- CreateTable
CREATE TABLE "fleet_switches" (
    "fleet_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fleet_switches_pkey" PRIMARY KEY ("fleet_id")
);

-- CreateTable
CREATE TABLE "installation_requests" (
    "request_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "fleet_id" TEXT,
    "enabled" BOOLEAN,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installation_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE INDEX "installation_requests_fleet_id_idx" ON "installation_requests"("fleet_id");

