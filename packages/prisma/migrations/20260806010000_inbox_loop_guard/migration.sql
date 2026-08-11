-- AlterEnum
ALTER TYPE "InboxItemStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "inboxBlockedSenders" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "inboxBlockedSubjects" TEXT[] DEFAULT ARRAY[]::TEXT[];

