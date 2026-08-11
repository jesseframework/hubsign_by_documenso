-- Where a corrected field value came from.
--
-- Until now every row here was a person typing. A PO number read out of an
-- attached purchase order is also a correction to the invoice's extracted data,
-- but it is different evidence and the screen has to be able to say which is
-- which. Existing rows were all human, hence the default.

-- AlterTable
ALTER TABLE "InboxFieldEdit" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "sourceDetail" TEXT;
