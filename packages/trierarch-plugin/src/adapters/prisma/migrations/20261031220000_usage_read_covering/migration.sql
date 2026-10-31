-- The Usage page's read (the usage design, "What the trierarch plugin stores"): a range is one index range scan of the fleet's
-- hours or days, every column the read takes included, so it reads no table pages. Written by hand: Prisma's schema cannot say INCLUDE.
CREATE INDEX "usage_hours_fleet_id_hour_read_idx" ON "usage_hours" ("fleet_id", "hour")
  INCLUDE ("machine_ship_id", "ship_id", "model", "harness", "login", "input", "output", "cache_read", "cache_write",
    "estimated_cost_input_usd", "estimated_cost_output_usd", "estimated_cost_cache_read_usd", "estimated_cost_cache_write_usd");

CREATE INDEX "usage_days_fleet_id_day_read_idx" ON "usage_days" ("fleet_id", "day")
  INCLUDE ("machine_ship_id", "ship_id", "model", "harness", "login", "input", "output", "cache_read", "cache_write",
    "estimated_cost_input_usd", "estimated_cost_output_usd", "estimated_cost_cache_read_usd", "estimated_cost_cache_write_usd",
    "unpriced_input", "unpriced_output", "unpriced_cache_read", "unpriced_cache_write");
