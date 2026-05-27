-- AlterTable
ALTER TABLE "Stamp" ALTER COLUMN "placeholders" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "ApprovalRoleMapping_organizationId_roleType_roleKey_approval_ke" RENAME TO "ApprovalRoleMapping_organizationId_roleType_roleKey_approva_key";

-- RenameIndex
ALTER INDEX "ApprovalValidationRule_organizationId_isActive_validationType_i" RENAME TO "ApprovalValidationRule_organizationId_isActive_validationTy_idx";
