CREATE TABLE "guard_read_failures" (
  "fleet_id" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "folder" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("fleet_id", "repository", "folder")
);
