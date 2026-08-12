-- Organization-defined fields on metadata records.
--
-- Values continue to live in "MetadataRecord"."data" (jsonb); this table only
-- declares that a field exists so the form, the table and the CSV know about it.
-- No backfill: every existing record simply has no custom values yet.

-- CreateEnum
CREATE TYPE "MetadataFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- CreateTable
CREATE TABLE "MetadataFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "MetadataFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataFieldDefinition_organizationId_category_idx" ON "MetadataFieldDefinition"("organizationId", "category");

-- One definition per key within a category: the key is the storage slot in the
-- record's data bag, so two fields sharing one would overwrite each other.
CREATE UNIQUE INDEX "MetadataFieldDefinition_organizationId_category_key_key" ON "MetadataFieldDefinition"("organizationId", "category", "key");
