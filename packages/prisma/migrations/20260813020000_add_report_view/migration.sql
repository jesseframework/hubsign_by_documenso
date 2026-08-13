-- Saved invoice reports: a named configuration of measure, grouping, window and
-- filters, so an organization builds the reports it needs from the fields it
-- defined rather than being shipped a page shaped around someone else's.
--
-- Org-scoped and shared, matching the rest of this product. The name is unique
-- within an organization so "save as" cannot silently produce two views with the
-- same label and different contents.

-- CreateTable
CREATE TABLE "ReportView" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdByUserId" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportView_organizationId_idx" ON "ReportView"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportView_organizationId_name_key" ON "ReportView"("organizationId", "name");
