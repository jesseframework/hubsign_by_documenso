# HubSign Organization (Multi-Tenancy) — Technical Specification
> v2.0 · April 2026 · UPDATED AFTER REVIEW

---

## 1. Overview

Add an **Organization** layer that wraps existing Teams. Organizations act as the tenant boundary for DMS data sharing and administration. **The existing signing system is NOT modified** — Organizations extend capabilities without impacting current routes or workflows.

```
Organization (Tenant)
  ├── Org Settings (branding, defaults)
  ├── Org Admins (separate from HubSign user admin)
  ├── DMS Admin (dedicated role for Document Manager)
  ├── Billing (per-user seat-based)
  ├── Shared DMS (filing structure, document types, classifications)
  │
  ├── Team: Sales
  │     ├── Team Admin
  │     ├── Members
  │     └── Team Documents & Templates (signing — unchanged)
  │
  ├── Team: Legal
  │     └── ...
  │
  └── Recycle Bin (soft-deleted DMS documents)
```

---

## 2. Key Principles

1. **Don't break signing** — All existing `/documents`, `/templates`, `/t/:teamUrl/...` routes remain untouched
2. **DMS permissions are separate** — A user can be a regular HubSign user BUT a DMS Admin within their org
3. **The Organization is optional** — Users without an org keep their personal signing + personal DMS as-is
4. **Additive only** — No existing database columns are removed or renamed

---

## 3. Data Model

### New Models

```prisma
model Organization {
  id          Int      @id @default(autoincrement())
  name        String
  slug        String   @unique
  domain      String?  @unique   // Optional: for auto-join by email domain
  logoUrl     String?

  defaultConfidentiality DmsConfidentiality @default(INTERNAL)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members     OrganizationMember[]
  teams       Team[]

  // Shared DMS
  dmsLocations       DmsLocation[]
  dmsDocumentTypes   DmsDocumentType[]
  dmsClassifications DmsClassification[]
  dmsTags            DmsTag[]
  dmsDocuments       DmsDocument[]
  dmsFilingRules     DmsFilingRule[]
  dmsComplianceTemplates DmsComplianceTemplate[]

  // Recycle Bin
  recycleBin  DmsRecycleBinItem[]
  savedSearches DmsSavedSearch[]
}

enum OrganizationRole {
  ORG_ADMIN      // Full org control
  DMS_ADMIN      // Full DMS control within org (filing, types, permissions)
  TEAM_ADMIN     // Manages their team
  MANAGER        // Can approve workflows, manage within scope
  MEMBER         // Regular user
}

model OrganizationMember {
  id     String           @id @default(cuid())
  role   OrganizationRole @default(MEMBER)

  organizationId Int
  organization   Organization @relation(...)

  userId Int
  user   User @relation(...)

  // DMS-specific permissions (set by DMS_ADMIN)
  dmsPermissions DmsOrgPermission[]

  joinedAt  DateTime @default(now())

  @@unique([organizationId, userId])
}
```

### DMS-Specific Permissions (Sub-Permission Matrix)

```prisma
enum DmsPermissionAction {
  VIEW
  UPLOAD
  DOWNLOAD
  EDIT
  DELETE
  MANAGE_FILING     // Create/edit locations, shelves, bins
  MANAGE_TYPES      // Create/edit document types, classifications
  APPROVE_WORKFLOWS
  APPROVE_RETRIEVALS
  MANAGE_RETENTION
  EXPORT
  VIEW_AUDIT_TRAIL
}

model DmsOrgPermission {
  id     String              @id @default(cuid())
  action DmsPermissionAction

  memberId String
  member   OrganizationMember @relation(...)

  // Optional scope — if null, applies to all docs in org
  locationId       String?    // Restrict to a specific location
  classificationId String?    // Restrict to a specific classification

  grantedById Int
  grantedBy   User @relation(...)

  createdAt DateTime @default(now())
}
```

### Recycle Bin

```prisma
model DmsRecycleBinItem {
  id        String   @id @default(cuid())
  
  documentId String  @unique
  document   DmsDocument @relation(...)
  
  deletedById Int
  deletedBy   User @relation(...)
  
  organizationId Int?
  organization   Organization? @relation(...)
  
  // Auto-purge after 30 days
  expiresAt DateTime
  
  createdAt DateTime @default(now())
}
```

### Saved Searches

```prisma
model DmsSavedSearch {
  id    String @id @default(cuid())
  name  String
  
  // Store the filter criteria as JSON
  /// [DmsSavedSearchCriteria]
  criteria Json
  
  // Who can see this saved search
  isShared Boolean @default(false)
  
  userId Int
  user   User @relation(...)
  
  organizationId Int?
  organization   Organization? @relation(...)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## 4. DMS Permission Matrix (Sub-Permissions)

When an Organization is created, the Org Admin assigns a **DMS Admin**. The DMS Admin then configures granular permissions for each member.

### Default Permissions by Role

| Permission | ORG_ADMIN | DMS_ADMIN | TEAM_ADMIN | MANAGER | MEMBER |
|-----------|-----------|-----------|------------|---------|--------|
| VIEW | ✅ All | ✅ All | ✅ Team docs | ✅ Assigned | ✅ Assigned |
| UPLOAD | ✅ | ✅ | ✅ | ✅ | ✅ |
| DOWNLOAD | ✅ All | ✅ All | ✅ Team docs | ✅ Assigned | ❌ |
| EDIT | ✅ | ✅ | ✅ Team docs | ❌ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ | ❌ |
| MANAGE_FILING | ✅ | ✅ | ❌ | ❌ | ❌ |
| MANAGE_TYPES | ✅ | ✅ | ❌ | ❌ | ❌ |
| APPROVE_WORKFLOWS | ✅ | ✅ | ✅ | ✅ | ❌ |
| APPROVE_RETRIEVALS | ✅ | ✅ | ✅ | ❌ | ❌ |
| MANAGE_RETENTION | ✅ | ✅ | ❌ | ❌ | ❌ |
| EXPORT | ✅ | ✅ | ✅ Team | ❌ | ❌ |
| VIEW_AUDIT_TRAIL | ✅ All | ✅ All | ✅ Team | Own only | Own only |

### Custom Permissions (DMS Admin can override)

The DMS Admin can grant/revoke specific permissions per member:
- Grant a MEMBER the ability to DOWNLOAD from a specific location
- Restrict a MANAGER from seeing documents in a specific classification
- Allow a specific user to MANAGE_RETENTION for their department

### How It Works (Without Impacting HubSign Users)

```
HubSign User System (unchanged):
  User.roles = [USER, ADMIN]
  ↳ Controls: signin, signup, admin panel, site settings

Organization System (new, separate):
  OrganizationMember.role = ORG_ADMIN | DMS_ADMIN | TEAM_ADMIN | MANAGER | MEMBER
  ↳ Controls: DMS access, document visibility, workflow approvals

These two systems are INDEPENDENT.
A user can be:
  - HubSign USER + Org DMS_ADMIN (manages documents, not the app)
  - HubSign ADMIN + Org MEMBER (manages the app, limited doc access)
```

---

## 5. Document Visibility by Confidentiality

| Confidentiality | ORG_ADMIN | DMS_ADMIN | TEAM_ADMIN | MANAGER | MEMBER |
|----------------|-----------|-----------|------------|---------|--------|
| PUBLIC | ✅ | ✅ | ✅ | ✅ | ✅ |
| INTERNAL | ✅ | ✅ | ✅ | ✅ | ✅ (if has VIEW permission) |
| CONFIDENTIAL | ✅ | ✅ | Own team only | ❌ | ❌ |
| RESTRICTED | ✅ | By explicit grant | ❌ | ❌ | ❌ |

---

## 6. URL Structure (Non-Breaking)

**Principle: Don't change any existing URLs. Add new org-scoped routes alongside.**

### Existing Routes (UNCHANGED):
```
/documents              — Personal signing documents
/documents/:id          — Document detail
/templates              — Personal templates
/t/:teamUrl/documents   — Team signing documents
/t/:teamUrl/templates   — Team templates
/settings/...           — User settings
/admin/...              — App admin (HubSign ADMIN role)
/signin, /signup        — Auth
```

### New Organization Routes (ADDED):
```
/dms                    — DMS (personal or org, detected from context)
/dms/org                — Org DMS dashboard (if user is in an org)
/dms/...                — All existing DMS routes work within org context

/org/settings           — Organization settings
/org/members            — Organization members & permissions
/org/teams              — Teams within organization
/org/billing            — Organization billing (seat management)
```

### How Context Works:
- If user is in an Organization → DMS routes show org-scoped data
- If user is NOT in an Organization → DMS routes show personal data (current behavior)
- The system auto-detects from the user's `OrganizationMember` record
- No URL changes needed — the backend resolves the org from the user session

---

## 7. Billing Model

### Per-User Seat-Based:
```
Organization Subscription:
  Base: $0 (org is free to create)
  Per Seat: $25/user/month (HubSign Pro features)
  DMS Add-On: $15/org/month (flat, enables DMS for all members)
  
  Total = (seats × $25) + $15 DMS
```

### Stripe Implementation:
```
Product: "HubSign Organization Seat"
  - Price: $25/month (metered, per seat)
  - metadata.plan: "org_seat"

Product: "DMS Organization Add-On"  
  - Price: $15/month (flat)
  - metadata.plan: "org_dms"
  - metadata.dmsEnabled: "true"
```

### Seat Management:
- Org Admin adds a member → seat count increases → Stripe quantity updated
- Org Admin removes a member → seat count decreases
- Auto-reconcile seat count monthly

---

## 8. New Features

### Recycle Bin
- When a DMS document is "deleted", it moves to the Recycle Bin
- Documents stay in Recycle Bin for 30 days
- Org Admin / DMS Admin can restore or permanently delete
- Auto-purge after 30 days (background job)
- Recycle Bin page in DMS sidebar

### Saved Searches
- User saves a search with filters (query, type, classification, date range, status, etc.)
- Saved searches appear in the Search page as quick-access chips
- Can be shared with the org (isShared = true) or personal
- Stored as JSON criteria in the database

---

## 9. Implementation Phases

### Phase 1: Schema + Migration (Non-Breaking)
- Add Organization, OrganizationMember, DmsOrgPermission models
- Add DmsRecycleBinItem, DmsSavedSearch models
- Add organizationId to DMS models (nullable)
- Run migration — nothing breaks

### Phase 2: Organization CRUD
- Create Organization
- Invite/remove members
- Role assignment
- Org settings page at /org/settings

### Phase 3: DMS Admin Permissions
- DMS Admin permission management UI
- Permission checks on all DMS operations
- Sub-permission matrix enforcement

### Phase 4: Org-Scoped DMS
- DMS queries use organizationId when user is in an org
- Filing structure shared across org
- Confidentiality enforcement
- Context detection (personal vs org)

### Phase 5: Recycle Bin + Saved Searches
- Soft delete → Recycle Bin
- Restore from Recycle Bin
- Auto-purge background job
- Saved search CRUD + UI

### Phase 6: Org Billing
- Seat-based subscription
- Stripe seat management
- Org billing dashboard

---

## 10. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing signing | No existing routes or queries modified |
| Breaking existing DMS | organizationId is nullable, personal DMS unchanged |
| Permission complexity | Clear defaults per role, DMS Admin overrides |
| Data leakage | Strict WHERE clauses with organizationId + confidentiality |
| Billing complexity | Separate org billing from personal billing |
| Migration | All additive, no destructive changes |

---

## 11. Decision Log (v2.0)

| Decision | Choice | Reason |
|----------|--------|--------|
| DMS permissions separate from HubSign | Yes | Don't impact existing user/admin system |
| DMS_ADMIN role | Yes | Dedicated DMS administrator within org |
| Sub-permission matrix | Yes | Granular control per member |
| URL structure | No changes to existing, add /org/* | Production safety |
| Context detection | Auto from session | No URL changes needed for DMS |
| Recycle Bin | 30-day soft delete | Enterprise standard, prevents accidents |
| Saved Searches | JSON criteria, shareable | Power user feature |
| Billing | Per-seat + flat DMS add-on | Fair pricing, simple model |

---

*v2.0 — Updated based on review feedback. Ready for implementation approval.*
