-- Drop the freehand pen tool from PDF markup.
--
-- A hand-drawn stroke on a signing page is indistinguishable from a signature
-- to anyone reading the finished document, while carrying none of a signature's
-- authentication or audit trail. Highlights and notes stay.

-- Any stroke already drawn goes with the tool; there is nothing left that can
-- render one.
DELETE FROM "DocumentAnnotation" WHERE "type" = 'DRAW';

-- `path` only ever held freehand point lists, and `strokeWidth` only ever sized
-- a pen.
ALTER TABLE "DocumentAnnotation" DROP COLUMN "path";
ALTER TABLE "DocumentAnnotation" DROP COLUMN "strokeWidth";

-- Postgres cannot remove a value from an enum in place, so the type is rebuilt
-- and the column moved across.
ALTER TYPE "DocumentAnnotationType" RENAME TO "DocumentAnnotationType_old";

CREATE TYPE "DocumentAnnotationType" AS ENUM ('HIGHLIGHT', 'NOTE');

ALTER TABLE "DocumentAnnotation"
  ALTER COLUMN "type" TYPE "DocumentAnnotationType"
  USING ("type"::text::"DocumentAnnotationType");

DROP TYPE "DocumentAnnotationType_old";
