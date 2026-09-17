import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// The "prisma-client" generator (used in prisma/schema.prisma) connects
// through a driver adapter instead of the bundled query engine, so the
// Postgres connection string is wired up here rather than read from a
// `url` on the datasource by the client at runtime.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

// Standard Next.js pattern: reuse one PrismaClient across hot reloads in
// dev, instead of opening a new connection pool on every file change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
