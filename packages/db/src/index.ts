import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __jspPrisma: PrismaClient | undefined;
}

// Reuse a single PrismaClient across hot reloads / multiple imports within
// the same process so we don't exhaust the Postgres connection pool.
export const prisma =
  global.__jspPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "verbose" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__jspPrisma = prisma;
}

export * from "@prisma/client";
