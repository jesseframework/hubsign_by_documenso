-- Org-scoped lookup directory used by the LOOKUP_METADATA workflow action.
CREATE TABLE "MetadataRecord" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "email" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetadataRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MetadataRecord_organizationId_category_key_key" ON "MetadataRecord"("organizationId", "category", "key");
CREATE INDEX "MetadataRecord_organizationId_category_idx" ON "MetadataRecord"("organizationId", "category");
