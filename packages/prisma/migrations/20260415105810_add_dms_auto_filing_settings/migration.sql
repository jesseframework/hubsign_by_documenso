-- CreateTable
CREATE TABLE "DmsAutoFilingSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "binId" TEXT,
    "documentTypeId" TEXT,
    "classificationId" TEXT,
    "confidentiality" "DmsConfidentiality" NOT NULL DEFAULT 'INTERNAL',
    "autoOcr" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsAutoFilingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DmsAutoFilingSettings_userId_key" ON "DmsAutoFilingSettings"("userId");

-- AddForeignKey
ALTER TABLE "DmsAutoFilingSettings" ADD CONSTRAINT "DmsAutoFilingSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAutoFilingSettings" ADD CONSTRAINT "DmsAutoFilingSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
