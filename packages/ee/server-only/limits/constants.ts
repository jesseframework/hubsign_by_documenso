import type { TLimitsSchema } from './schema';

export const FREE_PLAN_LIMITS: TLimitsSchema = {
  documents: 5,
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
