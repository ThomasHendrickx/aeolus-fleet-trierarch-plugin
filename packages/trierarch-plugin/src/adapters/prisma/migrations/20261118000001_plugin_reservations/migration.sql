CREATE TABLE "plugin_dispatch_reservations" (
  "fleet_id" TEXT NOT NULL,
  "plugin_ship_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("fleet_id", "plugin_ship_id", "request_id")
);
CREATE INDEX "plugin_dispatch_reservations_expires_at_idx" ON "plugin_dispatch_reservations" ("expires_at");
