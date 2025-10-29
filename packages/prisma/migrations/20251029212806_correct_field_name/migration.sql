/*
  Warnings:

  - You are about to drop the column `fieldPositionX` on the `FieldSignedPosition` table. All the data in the column will be lost.
  - You are about to drop the column `fieldPositionY` on the `FieldSignedPosition` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "FieldSignedPosition" DROP COLUMN "fieldPositionX",
DROP COLUMN "fieldPositionY",
ADD COLUMN     "fieldSignedPositionX" DECIMAL(65,30),
ADD COLUMN     "fieldSignedPositionY" DECIMAL(65,30);
