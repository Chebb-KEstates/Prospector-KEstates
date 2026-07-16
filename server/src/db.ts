import { PrismaClient } from '@prisma/client';

/** Single shared Prisma client for the process. */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
