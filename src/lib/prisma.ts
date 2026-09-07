import { PrismaClient } from "@/src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const createPrismaClient = () => {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter });
};

// Singleton pattern — prevents exhausting the connection pool in dev
// due to Next.js hot-reloading creating new instances on every change.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
