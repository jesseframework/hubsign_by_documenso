import type { Field, FieldSignedPosition, Signature } from '@prisma/client';

export type FieldWithSignature = Field & {
  signature?: Signature | null;
  fieldSignedPosition?: FieldSignedPosition | null;
};
