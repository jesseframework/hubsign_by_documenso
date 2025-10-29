/*
  Warnings:

  - You are about to drop the `FieldPosition` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FieldPosition" DROP CONSTRAINT "FieldPosition_fieldId_fkey";

-- DropForeignKey
ALTER TABLE "FieldPosition" DROP CONSTRAINT "FieldPosition_recipientId_fkey";

-- DropTable
DROP TABLE "FieldPosition";

-- CreateTable
CREATE TABLE "FieldSignedPosition" (
    "id" SERIAL NOT NULL,
    "fieldPositionX" DECIMAL(65,30),
    "fieldPositionY" DECIMAL(65,30),
    "fieldId" INTEGER NOT NULL,
    "recipientId" INTEGER NOT NULL,

    CONSTRAINT "FieldSignedPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldSignedPosition_fieldId_key" ON "FieldSignedPosition"("fieldId");

-- CreateIndex
CREATE INDEX "FieldSignedPosition_fieldId_idx" ON "FieldSignedPosition"("fieldId");

-- CreateIndex
CREATE INDEX "FieldSignedPosition_recipientId_idx" ON "FieldSignedPosition"("recipientId");

-- AddForeignKey
ALTER TABLE "FieldSignedPosition" ADD CONSTRAINT "FieldSignedPosition_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldSignedPosition" ADD CONSTRAINT "FieldSignedPosition_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field"("id") ON DELETE CASCADE ON UPDATE CASCADE;
