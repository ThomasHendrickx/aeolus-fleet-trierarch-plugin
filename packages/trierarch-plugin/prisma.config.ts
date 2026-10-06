import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'src/adapters/prisma/schema.prisma',
  migrations: {
    path: 'src/adapters/prisma/migrations',
  },
  datasource: {
    // Only migrate commands need the URL; `prisma generate` runs without one.
    url: process.env.DATABASE_URL,
  },
});
