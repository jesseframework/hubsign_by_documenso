-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "renewalReminderSentForPeriodEnd" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "renewalReminderSentForPeriodEnd" TIMESTAMP(3);
