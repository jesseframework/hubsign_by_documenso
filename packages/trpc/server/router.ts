import { adminRouter } from './admin-router/router';
import { apiTokenRouter } from './api-token-router/router';
import { approvalRouter } from './approval-router/router';
import { aubreyRouter } from './aubrey-router/router';
import { authRouter } from './auth-router/router';
import { dmsRouter } from './dms-router/router';
import { documentRouter } from './document-router/router';
import { orgRouter } from './org-router/router';
import { embeddingPresignRouter } from './embedding-router/_router';
import { fieldRouter } from './field-router/router';
import { folderRouter } from './folder-router/router';
import { inboxRouter } from './inbox-router/router';
import { metadataRouter } from './metadata-router/router';
import { msTeamsRouter } from './ms-teams-router/router';
import { profileRouter } from './profile-router/router';
import { pushRouter } from './push-router/router';
import { recipientRouter } from './recipient-router/router';
import { shareLinkRouter } from './share-link-router/router';
import { stampRouter } from './stamp-router/router';
import { teamRouter } from './team-router/router';
import { templateRouter } from './template-router/router';
import { router } from './trpc';
import { webhookRouter } from './webhook-router/router';
import { businessRuleRouter } from './business-rule-router/router';
import { emailTemplateRouter } from './email-template-router/router';
import { exportRouter } from './export-router/router';
import { workflowRouter } from './workflow-router/router';

export const appRouter = router({
  auth: authRouter,
  profile: profileRouter,
  document: documentRouter,
  dms: dmsRouter,
  org: orgRouter,
  field: fieldRouter,
  folder: folderRouter,
  recipient: recipientRouter,
  admin: adminRouter,
  shareLink: shareLinkRouter,
  apiToken: apiTokenRouter,
  team: teamRouter,
  template: templateRouter,
  webhook: webhookRouter,
  embeddingPresign: embeddingPresignRouter,
  push: pushRouter,
  stamp: stampRouter,
  workflow: workflowRouter,
  emailTemplate: emailTemplateRouter,
  businessRule: businessRuleRouter,
  approval: approvalRouter,
  inbox: inboxRouter,
  metadata: metadataRouter,
  export: exportRouter,
  msTeams: msTeamsRouter,
  aubrey: aubreyRouter,
});

export type AppRouter = typeof appRouter;
