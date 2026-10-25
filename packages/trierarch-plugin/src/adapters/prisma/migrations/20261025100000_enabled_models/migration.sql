-- CreateTable
CREATE TABLE "enabled_models" (
    "fleet_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,

    CONSTRAINT "enabled_models_pkey" PRIMARY KEY ("fleet_id","model")
);
