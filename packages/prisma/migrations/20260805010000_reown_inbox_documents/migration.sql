-- Consolidate ownership of signature-inbox documents onto one account per org.
--
-- Both ingestion paths attributed the document to the emailing user whenever
-- that user happened to be an org member. But the signature inbox is a SHARED
-- queue while document access is owner-scoped — `getDocumentWhereInput` reduces
-- to `OR: [{ userId }]` for a document with no team. The result: a document
-- emailed in by a member was invisible to whoever actually operated the inbox.
-- It never appeared in their E-Sign list and "Open in editor" failed, even
-- though the inbox row rendered normally (that path is org-scoped).
--
-- Ownership now sits with the org's inbox owner: its first ORG_ADMIN by join
-- date. `SignatureInboxItem.senderEmail` and `receivedById` still record who
-- sent it, so no attribution is lost — only the access path changes.
--
-- `role ASC` is meaningful: Postgres orders enum columns by declaration order,
-- and `OrganizationRole` declares ORG_ADMIN first, so admins sort ahead of
-- members. This mirrors `resolveInboxOwnerUserId` in application code.

UPDATE "Document" d
SET "userId" = owner.user_id
FROM "SignatureInboxItem" i,
     LATERAL (
       SELECT m."userId" AS user_id
       FROM "OrganizationMember" m
       WHERE m."organizationId" = i."organizationId"
       ORDER BY m.role ASC, m."joinedAt" ASC
       LIMIT 1
     ) owner
WHERE d.id = i."documentId"
  AND d."userId" <> owner.user_id;
