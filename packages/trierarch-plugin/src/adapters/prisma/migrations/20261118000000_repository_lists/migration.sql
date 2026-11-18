CREATE TABLE "repository_lists" (
  "fleet_id" TEXT NOT NULL PRIMARY KEY,
  "version" INTEGER NOT NULL,
  "repositories" JSONB NOT NULL
);
CREATE TABLE "repository_events" (
  "fleet_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "actor" JSONB NOT NULL,
  "operation" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  PRIMARY KEY ("fleet_id", "version")
);
