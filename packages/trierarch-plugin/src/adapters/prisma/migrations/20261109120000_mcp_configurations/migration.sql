-- CreateTable
CREATE TABLE "mcp_configurations" (
    "fleet_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "servers" JSONB NOT NULL,
    "replaced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mcp_configurations_pkey" PRIMARY KEY ("fleet_id")
);

-- CreateTable
CREATE TABLE "mcp_secrets" (
    "fleet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "mcp_secrets_pkey" PRIMARY KEY ("fleet_id","name")
);

-- CreateTable
CREATE TABLE "mcp_configuration_events" (
    "id" BIGSERIAL NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_account_id" TEXT,
    "changed_servers" TEXT[],
    "changed_secrets" TEXT[],
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mcp_configuration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_configuration_events_fleet_id_version_key" ON "mcp_configuration_events"("fleet_id", "version");
