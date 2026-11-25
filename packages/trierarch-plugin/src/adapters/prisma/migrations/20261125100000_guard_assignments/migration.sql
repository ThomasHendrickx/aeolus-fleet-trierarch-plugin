CREATE TABLE "guard_resolutions" (
  "fleet_id" TEXT NOT NULL,
  "ship_id" TEXT NOT NULL,
  "settings_version" INTEGER NOT NULL,
  "sets" JSONB NOT NULL,
  PRIMARY KEY ("fleet_id", "ship_id", "settings_version")
);

CREATE TABLE "guard_delivery_attempts" (
  "fleet_id" TEXT NOT NULL,
  "ship_id" TEXT NOT NULL,
  "settings_version" INTEGER NOT NULL,
  "trierarch_ship_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  PRIMARY KEY ("fleet_id", "ship_id", "settings_version", "trierarch_ship_id")
);
