import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient, type Prisma } from './generated/client.js';

export type { PrismaClient } from './generated/client.js';

/** The client itself, or the client of one interactive transaction. Repositories take either. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Creates a Prisma client on a pg connection pool for the given database. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Throws when the database cannot answer a trivial query. */
export async function checkDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
