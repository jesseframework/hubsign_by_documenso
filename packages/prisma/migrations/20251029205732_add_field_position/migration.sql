-- CreateTable
CREATE TABLE "FieldPosition" (
    "id" SERIAL NOT NULL,
    "fieldPositionX" DECIMAL(65,30),
    "fieldPositionY" DECIMAL(65,30),
    "fieldId" INTEGER NOT NULL,
    "recipientId" INTEGER NOT NULL,

    CONSTRAINT "FieldPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldPosition_fieldId_idx" ON "FieldPosition"("fieldId");

-- CreateIndex
CREATE INDEX "FieldPosition_fieldPositionX_idx" ON "FieldPosition"("fieldPositionX");

-- CreateIndex
CREATE INDEX "FieldPosition_fieldPositionY_idx" ON "FieldPosition"("fieldPositionY");

-- AddForeignKey
ALTER TABLE "FieldPosition" ADD CONSTRAINT "FieldPosition_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldPosition" ADD CONSTRAINT "FieldPosition_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field"("id") ON DELETE CASCADE ON UPDATE CASCADE;
