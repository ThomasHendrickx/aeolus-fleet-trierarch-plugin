CREATE TABLE "guard_configurations" (
  "fleet_id" TEXT NOT NULL PRIMARY KEY,
  "version" INTEGER NOT NULL,
  "repositories" JSONB NOT NULL,
  "floor" TEXT[] NOT NULL
);
CREATE TABLE "guard_secrets" (
  "fleet_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  PRIMARY KEY ("fleet_id", "name")
);
CREATE TABLE "guard_snapshots" (
  "fleet_id" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "folder" TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  PRIMARY KEY ("fleet_id", "repository", "folder")
);
