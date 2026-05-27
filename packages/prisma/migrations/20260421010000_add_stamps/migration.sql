-- CreateEnum
CREATE TYPE "StampKind" AS ENUM ('UPLOADED', 'DESIGNED', 'AI_GENERATED');

-- CreateTable
CREATE TABLE "Stamp" (
    "id" TEXT NOT NULL,
    "userId" INTEGER,
    "teamId" INTEGER,
    "name" TEXT NOT NULL,
    "kind" "StampKind" NOT NULL,
    "imageAssetId" TEXT,
    "layout" JSONB,
    "placeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previewImage" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stamp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stamp_userId_idx" ON "Stamp"("userId");
CREATE INDEX "Stamp_teamId_idx" ON "Stamp"("teamId");

-- AddForeignKey
ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
