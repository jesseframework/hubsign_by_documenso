import type { TLimitsSchema } from './schema';

export const FREE_PLAN_LIMITS: TLimitsSchema = {
  documents: 3,
  recipients: 10,
  directTemplates: 3,
  dmsEnabled: false,
};

export const TEAM_PLAN_LIMITS: TLimitsSchema = {
  documents: Infinity,
  recipients: Infinity,
  directTemplates: Infinity,
  dmsEnabled: false,
};

export const SELFHOSTED_PLAN_LIMITS: TLimitsSchema = {
  documents: Infinity,
  recipients: Infinity,
  directTemplates: Infinity,
  dmsEnabled: true,
};

// DMS add-on — when a user has an active DMS subscription
export const DMS_ADDON_LIMITS: Partial<TLimitsSchema> = {
  dmsEnabled: true,
};

// License-key activation (WorkHub-minted). After a grant's expiry we keep access
// for a grace window, then fail closed to Free (the decision: "grace, then close").
export const LICENSE_GRACE_DAYS = 7;

// Quota an INDIVIDUAL license grant confers (the paid Individual plan is
// "unlimited signing for individuals"). dmsEnabled is turned on per-grant from
// the key's add-ons, not here.
export const INDIVIDUAL_LICENSE_LIMITS: TLimitsSchema = {
  documents: Infinity,
  recipients: Infinity,
  directTemplates: Infinity,
  dmsEnabled: false,
};
