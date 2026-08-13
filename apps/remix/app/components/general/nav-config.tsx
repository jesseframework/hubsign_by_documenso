import { Trans } from '@lingui/react/macro';
import type { OrganizationRole } from '@prisma/client';
import {
  ActivityIcon,
  ArchiveIcon,
  BarChart3Icon,
  BellIcon,
  BotIcon,
  BracesIcon,
  Building2Icon,
  BuildingIcon,
  CheckSquareIcon,
  Code2Icon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  ClockIcon,
  CombineIcon,
  CpuIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileSearchIcon,
  FileSpreadsheetIcon,
  FileStackIcon,
  FileTextIcon,
  FolderArchiveIcon,
  FolderTreeIcon,
  GaugeIcon,
  Globe2Icon,
  HeartIcon,
  InboxIcon,
  KeyRoundIcon,
  ReceiptIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LockIcon,
  MailIcon,
  PenLineIcon,
  PlugIcon,
  ScaleIcon,
  Settings2Icon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  StampIcon,
  Trash2Icon,
  TrophyIcon,
  UploadCloudIcon,
  UserCogIcon,
  UserIcon,
  Users2Icon,
  UsersIcon,
  WebhookIcon,
  WorkflowIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';

/**
 * Single source of truth for every navigation surface in the app.
 *
 * The information architecture has three tiers, and an item belongs to exactly
 * one of them:
 *
 *   1. Primary nav (sidebar)  — the handful of places you *go* during a normal
 *                               day. Capped at 7 rows plus the pinned consoles.
 *   2. Surfaces (tab strips)  — peer *views of the same object*. These are tabs
 *                               on one screen, never sibling sidebar rows.
 *   3. Consoles (side rails)  — configuration and administration. Destinations
 *                               you enter deliberately, not nav you scan past.
 *
 * Every path appears in exactly ONE registry below. That invariant is what
 * makes the nav memorable: a user who learns where something lives is never
 * contradicted by finding it somewhere else too. `resolveConsole` and
 * `resolveSurface` both derive from these registries, so adding an entry here
 * is all that is needed for the chrome to pick it up.
 */

export type NavIcon = React.ComponentType<{ className?: string }>;

export type NavItem = {
  to: string;
  icon: NavIcon;
  label: React.ReactNode;
  /** Match the path exactly. Required for index routes that prefix others. */
  exact?: boolean;
  /** Org roles allowed to see this item. Omit for items every member may use. */
  roles?: OrganizationRole[];
  /**
   * Also show to a user who belongs to NO organization. Only for the entry
   * point that lets them create one — the role filter treats "no org" as "no
   * permission", which would otherwise make org creation unreachable.
   */
  alsoWithoutOrg?: boolean;
  /**
   * Hide unless the Document Manager add-on is in the subscription. Implies an
   * organization: `dmsEnabled` is only ever granted through an org seat tier or
   * an org DMS add-on (see `getServerLimits`), never to a personal account.
   */
  requiresDms?: boolean;
  /**
   * Hide for users who belong to no organization. Needed only for `/org/*`
   * items with no role gate of their own — a role gate already excludes them,
   * since "no org" resolves to "no permission".
   *
   * Without this a personal account was offered an org dashboard, an inbox and
   * an approvals queue whose procedures all throw FORBIDDEN for them: nav rows
   * that could only ever lead to an error page.
   */
  requiresOrg?: boolean;
  /**
   * Hide for users who belong to an organization. Org seat limits supersede
   * personal billing entirely (see `getServerLimits`), so showing a personal
   * billing page to an org member offers a setting that cannot take effect.
   */
  personalOnly?: boolean;
  /**
   * The surface this row opens. A row stays lit while the user is on any tab of
   * that surface, which is what lets a row point at a shell route (`/tasks`)
   * that only ever redirects onward to a tab.
   */
  surface?: SurfaceId;
  /**
   * Rewrite to `/t/:teamUrl/...` when the user is inside a team. Only the
   * signing surfaces are team-scoped; org, repository and console routes are
   * organization-wide and must not be rewritten.
   */
  teamScoped?: boolean;
};

/** Applies {@link NavItem.teamScoped}, returning an item with a resolved `to`. */
export const resolveTeamHref = (item: NavItem, teamUrl: string | undefined): NavItem =>
  item.teamScoped && teamUrl ? { ...item, to: `/t/${teamUrl}${item.to}` } : item;

export type NavGroup = {
  id: string;
  label: React.ReactNode;
  /**
   * Shown when the group is drawn as a collapsible category in the console rail,
   * which is how a console with more than one group renders (see `ConsoleShell`).
   * Optional because a single-group console draws its items flat, with no parent
   * row for an icon to sit on.
   */
  icon?: NavIcon;
  items: NavItem[];
};

export type ConsoleId = 'settings' | 'account' | 'admin';

export type ConsoleDef = {
  id: ConsoleId;
  title: React.ReactNode;
  /** Where the console's own top-level entry point lands. */
  home: string;
  groups: NavGroup[];
};

export type SurfaceId = 'home' | 'inbox' | 'repository' | 'tasks';

export type SurfaceDef = {
  id: SurfaceId;
  title: React.ReactNode;
  tabs: NavItem[];
};

/**
 * Presentation-only role gates. The page itself must still refuse the data —
 * a hidden link is not an access control.
 */
const ORG_ADMIN_ONLY: OrganizationRole[] = ['ORG_ADMIN'];
/**
 * `Access Control` additionally admits DMS_ADMIN, matching the check the page
 * already performs. Gating it to ORG_ADMIN alone locks DMS admins out of their
 * own screen.
 */
const DMS_ADMIN_TOO: OrganizationRole[] = ['ORG_ADMIN', 'DMS_ADMIN'];

// ---------------------------------------------------------------------------
// Tier 1 — primary nav
// ---------------------------------------------------------------------------

/**
 * The daily-work rows. Deliberately short and, apart from the DMS add-on gate,
 * identical for every user: role differences change what is *inside* a page,
 * not what is *on* the nav, so colleagues can describe a location to each other
 * and spatial memory survives a change of role.
 */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/org', icon: LayoutDashboardIcon, label: <Trans>Home</Trans>, exact: true, surface: 'home' },
  { to: '/org/inbox', icon: InboxIcon, label: <Trans>Inbox</Trans>, surface: 'inbox' },
  // Deliberately not "Documents": the Repository holds documents too, and a
  // user cannot be expected to remember which of two identically-named rows
  // holds the file they want. "E-Sign" names the workflow instead of the object.
  { to: '/documents', icon: PenLineIcon, label: <Trans>E-Sign</Trans>, teamScoped: true },
  {
    // Not DMS-gated at the row: the Trash view is backed by an org-level API
    // and stays available without the add-on, so hiding the row entirely would
    // orphan the recycle bin. `resolvePrimaryHref` lands the row on whichever
    // view the user can actually see.
    to: '/dms/documents',
    icon: FolderArchiveIcon,
    label: <Trans>Repository</Trans>,
    surface: 'repository',
  },
  { to: '/templates', icon: FileTextIcon, label: <Trans>Templates</Trans>, teamScoped: true },
  { to: '/tasks', icon: CheckSquareIcon, label: <Trans>Tasks</Trans>, surface: 'tasks' },
];

/** The one genuine sidebar submenu: utilities you run, rather than places you go. */
export const TOOLS_NAV: NavItem[] = [
  { to: '/doc-merge', icon: CombineIcon, label: <Trans>Merge</Trans> },
  {
    to: '/dms/bulk-upload',
    icon: UploadCloudIcon,
    label: <Trans>Bulk Upload</Trans>,
    requiresDms: true,
  },
  {
    to: '/org/exports',
    icon: FileSpreadsheetIcon,
    label: <Trans>Exports</Trans>,
    requiresOrg: true,
  },
  { to: '/dms/ai', icon: BotIcon, label: <Trans>AI Agent</Trans>, requiresDms: true },
];

export const TOOLS_ITEM: NavItem = {
  to: '/doc-merge',
  icon: WrenchIcon,
  label: <Trans>Tools</Trans>,
};

// ---------------------------------------------------------------------------
// Tier 2 — surfaces
// ---------------------------------------------------------------------------

/**
 * Tab strips. Each entry is a set of views over one conceptual object, so they
 * read as one screen rather than as adjacent destinations.
 *
 * `Processing` sits under Repository, not Inbox. It was originally grouped with
 * Inbox on the reasoning that OCR is a state documents pass through on the way
 * in — but Inbox in this product means the *signature* inbox, invoices emailed
 * in for someone to send for signature, and the OCR queue reports on the DMS
 * repository instead. Two different pipelines, and putting them side by side
 * implied the queue was showing progress on the signature inbox. It belongs
 * with the repository whose documents it is actually reporting on.
 */
export const SURFACES: SurfaceDef[] = [
  {
    id: 'home',
    title: <Trans>Home</Trans>,
    tabs: [
      {
        to: '/org',
        icon: LayoutDashboardIcon,
        label: <Trans>Overview</Trans>,
        exact: true,
        requiresOrg: true,
      },
      { to: '/org/sla', icon: GaugeIcon, label: <Trans>SLA</Trans>, requiresOrg: true },
      // Beside SLA rather than under Repository: both are readings of the same
      // invoice flow — how fast it moved, and what it came to.
      {
        to: '/org/spend',
        icon: ReceiptIcon,
        label: <Trans>Spend</Trans>,
        requiresOrg: true,
      },
      { to: '/dms/activity', icon: ActivityIcon, label: <Trans>Activity</Trans>, requiresDms: true },
    ],
  },
  {
    id: 'inbox',
    title: <Trans>Inbox</Trans>,
    tabs: [
      { to: '/org/inbox', icon: InboxIcon, label: <Trans>Incoming</Trans>, requiresOrg: true },
    ],
  },
  {
    id: 'repository',
    title: <Trans>Repository</Trans>,
    tabs: [
      {
        to: '/dms',
        icon: LayoutDashboardIcon,
        label: <Trans>Overview</Trans>,
        exact: true,
        requiresDms: true,
      },
      { to: '/dms/documents', icon: ArchiveIcon, label: <Trans>Browse</Trans>, requiresDms: true },
      // Next to Browse: these are the repository's own documents, still being
      // read. Somewhere a user checks on progress, not a destination in itself.
      {
        to: '/dms/ocr-queue',
        icon: CpuIcon,
        label: <Trans>Processing</Trans>,
        requiresDms: true,
      },
      { to: '/dms/search', icon: FileSearchIcon, label: <Trans>Search</Trans>, requiresDms: true },
      { to: '/dms/favorites', icon: HeartIcon, label: <Trans>Favorites</Trans>, requiresDms: true },
      { to: '/org/recycle-bin', icon: Trash2Icon, label: <Trans>Trash</Trans>, requiresOrg: true },
    ],
  },
  {
    id: 'tasks',
    title: <Trans>Tasks</Trans>,
    tabs: [
      // Two queues that both mean "waiting on me", but backed by different
      // engines: `/org/approvals` is the approval-chain module, `/dms/approvals`
      // is DMS workflow steps. Presenting them as one list would need a union
      // query across both, so for now they are tabs named for what they hold —
      // never two tabs both called "Approvals", which is what made the previous
      // nav unguessable.
      {
        to: '/org/approvals',
        icon: ClipboardCheckIcon,
        label: <Trans>Approvals</Trans>,
        requiresOrg: true,
      },
      {
        to: '/dms/approvals',
        icon: CheckSquareIcon,
        label: <Trans>Workflow Steps</Trans>,
        requiresDms: true,
      },
      {
        to: '/dms/retrievals',
        icon: ClipboardListIcon,
        label: <Trans>Retrievals</Trans>,
        requiresDms: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tier 3 — consoles
// ---------------------------------------------------------------------------

/**
 * Organizational configuration. Grouped by the thing being configured rather
 * than by the module that happens to own the route, which is why `/org/*` and
 * `/dms/*` paths sit side by side here — a user setting up document handling
 * should not have to know which service implements retention.
 */
export const SETTINGS_CONSOLE: ConsoleDef = {
  id: 'settings',
  title: <Trans>Settings</Trans>,
  home: '/org/settings',
  groups: [
    {
      id: 'organization',
      label: <Trans>Organization</Trans>,
      icon: Building2Icon,
      items: [
        // Two entries for one path, mutually exclusive by context. `/org/settings`
        // is both the org profile form and the only route to creating an
        // organization, and calling it "Profile & Branding" to someone with no
        // organization describes a thing that does not exist yet.
        {
          to: '/org/settings',
          icon: BuildingIcon,
          label: <Trans>Create Organization</Trans>,
          personalOnly: true,
        },
        {
          to: '/org/settings',
          icon: BuildingIcon,
          label: <Trans>Profile & Branding</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
        {
          to: '/org/members',
          icon: UsersIcon,
          label: <Trans>Members & Roles</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
        { to: '/settings/teams', icon: Users2Icon, label: <Trans>Teams</Trans> },
        {
          to: '/org/billing',
          icon: CreditCardIcon,
          label: <Trans>Billing & Plan</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
        {
          to: '/org/integrations',
          icon: PlugIcon,
          label: <Trans>Integrations</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
      ],
    },
    {
      id: 'documents',
      label: <Trans>Documents</Trans>,
      icon: FileStackIcon,
      items: [
        {
          to: '/dms/filing',
          icon: FolderTreeIcon,
          label: <Trans>Filing Structure</Trans>,
          requiresDms: true,
        },
        {
          to: '/org/metadata',
          icon: DatabaseIcon,
          label: <Trans>Metadata Fields</Trans>,
          requiresOrg: true,
        },
        {
          to: '/dms/retention',
          icon: ClockIcon,
          label: <Trans>Retention</Trans>,
          requiresDms: true,
        },
        { to: '/org/stamps', icon: StampIcon, label: <Trans>Stamps</Trans>, requiresOrg: true },
        {
          to: '/org/permissions',
          icon: KeyRoundIcon,
          label: <Trans>Access Control</Trans>,
          roles: DMS_ADMIN_TOO,
        },
        {
          to: '/dms/compliance',
          icon: ShieldCheckIcon,
          label: <Trans>Compliance</Trans>,
          requiresDms: true,
        },
        {
          to: '/dms/settings',
          icon: SlidersHorizontalIcon,
          label: <Trans>Repository Options</Trans>,
          requiresDms: true,
        },
      ],
    },
    {
      id: 'automation',
      label: <Trans>Automation</Trans>,
      icon: ZapIcon,
      items: [
        {
          to: '/org/workflows',
          icon: WorkflowIcon,
          label: <Trans>Workflows</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
        {
          to: '/org/business-rules',
          icon: ScaleIcon,
          label: <Trans>Business Rules</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
        {
          to: '/org/approval-templates',
          icon: ListChecksIcon,
          label: <Trans>Approval Templates</Trans>,
          requiresOrg: true,
        },
        {
          /*
            Reachable from the navigation, not only from a button on the templates
            page. This holds the role → approver mappings a blocked signer picks
            from when asking for a signing exception, and with no nav row the only
            way in was a button labelled "Rules & validations" — which gives no hint
            that approver groups live behind it.
          */
          to: '/org/approval-config',
          icon: SlidersHorizontalIcon,
          label: <Trans>Approver Roles &amp; Rules</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
        {
          to: '/org/email-templates',
          icon: MailIcon,
          label: <Trans>Email Templates</Trans>,
          roles: ORG_ADMIN_ONLY,
        },
      ],
    },
    {
      id: 'developer',
      label: <Trans>Developer</Trans>,
      icon: Code2Icon,
      items: [
        { to: '/settings/tokens', icon: BracesIcon, label: <Trans>API Tokens</Trans> },
        { to: '/settings/webhooks', icon: WebhookIcon, label: <Trans>Webhooks</Trans> },
      ],
    },
  ],
};

/**
 * Personal preferences, reached from the avatar menu rather than the nav.
 *
 * Kept rigorously separate from {@link SETTINGS_CONSOLE}: "my settings" and
 * "our settings" sharing a menu was the single most confusing adjacency in the
 * previous nav, where a personal `Settings` group sat one row below
 * `Organization → Settings`.
 */
export const ACCOUNT_CONSOLE: ConsoleDef = {
  id: 'account',
  title: <Trans>Account</Trans>,
  home: '/settings/profile',
  groups: [
    {
      id: 'account',
      label: <Trans>Account</Trans>,
      items: [
        { to: '/settings/profile', icon: UserIcon, label: <Trans>Profile</Trans> },
        { to: '/settings/public-profile', icon: Globe2Icon, label: <Trans>Public Profile</Trans> },
        { to: '/settings/security', icon: LockIcon, label: <Trans>Security</Trans> },
        { to: '/settings/notifications', icon: BellIcon, label: <Trans>Notifications</Trans> },
        {
          to: '/settings/billing',
          icon: CreditCardIcon,
          label: <Trans>Billing</Trans>,
          personalOnly: true,
        },
      ],
    },
  ],
};

/**
 * Platform administration. A separate context on purpose — it is rendered with
 * distinct chrome so it is obvious you have left the product.
 */
export const ADMIN_CONSOLE: ConsoleDef = {
  id: 'admin',
  title: <Trans>Platform Admin</Trans>,
  home: '/admin/stats',
  groups: [
    {
      id: 'admin',
      label: <Trans>Platform</Trans>,
      items: [
        { to: '/admin/stats', icon: BarChart3Icon, label: <Trans>Stats</Trans> },
        // Named `Accounts`, not `Users`, so it cannot be confused with the
        // organization's `Members & Roles` — different scope, different word.
        { to: '/admin/users', icon: UserCogIcon, label: <Trans>Accounts</Trans> },
        { to: '/admin/documents', icon: FileStackIcon, label: <Trans>Documents</Trans> },
        { to: '/admin/leaderboard', icon: TrophyIcon, label: <Trans>Leaderboard</Trans> },
        { to: '/admin/site-settings', icon: Settings2Icon, label: <Trans>Site Settings</Trans> },
      ],
    },
  ],
};

export const CONSOLES: ConsoleDef[] = [SETTINGS_CONSOLE, ACCOUNT_CONSOLE, ADMIN_CONSOLE];

/**
 * Pinned below the divider in the sidebar — doors, not daily destinations.
 *
 * Ordered by widening scope: me, then my organization, then the platform.
 *
 * `Account` is a labelled row and not only the avatar dropdown. The dropdown
 * still works, but an avatar is an ambiguous affordance: nothing about a face
 * and an email address says "Notifications live in here", and the first reading
 * of the restructured sidebar was that those pages had been deleted. A door
 * people cannot see is not meaningfully different from a missing one.
 */
export const ACCOUNT_ITEM: NavItem = {
  to: ACCOUNT_CONSOLE.home,
  icon: UserIcon,
  label: <Trans>Account</Trans>,
};

export const SETTINGS_ITEM: NavItem = {
  to: SETTINGS_CONSOLE.home,
  icon: SettingsIcon,
  label: <Trans>Settings</Trans>,
};

export const ADMIN_ITEM: NavItem = {
  to: ADMIN_CONSOLE.home,
  icon: ShieldIcon,
  label: <Trans>Admin</Trans>,
};

// ---------------------------------------------------------------------------
// Filtering + resolution
// ---------------------------------------------------------------------------

export type NavContext = {
  /** Undefined when the user belongs to no organization. */
  orgRole: OrganizationRole | undefined;
  isDmsEnabled: boolean;
};

export const isItemVisible = (item: NavItem, ctx: NavContext): boolean => {
  if (item.requiresDms && !ctx.isDmsEnabled) {
    return false;
  }

  if (item.personalOnly && ctx.orgRole !== undefined) {
    return false;
  }

  if (item.requiresOrg && ctx.orgRole === undefined) {
    return false;
  }

  if (!item.roles) {
    return true;
  }

  // Not in an org: only the item that leads to creating one. Everything else
  // would 'Administrators only' at them, which is not the real problem.
  if (ctx.orgRole === undefined) {
    return item.alsoWithoutOrg === true;
  }

  return item.roles.includes(ctx.orgRole);
};

export const filterItems = (items: NavItem[], ctx: NavContext): NavItem[] =>
  items.filter((item) => isItemVisible(item, ctx));

export const getSurface = (id: SurfaceId): SurfaceDef | undefined =>
  SURFACES.find((surface) => surface.id === id);

/**
 * Where a primary nav row should land. A row that opens a surface points at the
 * first view the user can actually see, rather than at a fixed path that a
 * subscription gate might have taken away — which is what keeps the Repository
 * row useful for an organization without the Document Manager add-on, whose
 * only visible view is Trash.
 */
export const resolvePrimaryHref = (item: NavItem, ctx: NavContext): string => {
  if (!item.surface) {
    return item.to;
  }

  const surface = getSurface(item.surface);

  return surface ? (filterItems(surface.tabs, ctx)[0]?.to ?? item.to) : item.to;
};

/**
 * Primary rows, minus any whose surface has no view left to show. Prevents a
 * row that leads nowhere from occupying a slot in a nav this deliberately short.
 */
export const getPrimaryNav = (ctx: NavContext): NavItem[] =>
  filterItems(PRIMARY_NAV, ctx).filter((item) => {
    if (!item.surface) {
      return true;
    }

    const surface = getSurface(item.surface);

    return !surface || filterItems(surface.tabs, ctx).length > 0;
  });

export const filterGroups = (groups: NavGroup[], ctx: NavContext): NavGroup[] =>
  groups
    .map((group) => ({ ...group, items: filterItems(group.items, ctx) }))
    .filter((group) => group.items.length > 0);

export const isPathActive = (item: NavItem, pathname: string): boolean =>
  item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

/**
 * Longest-prefix match, so `/org/settings` resolves to the settings console
 * while a bare `/org` (an exact-only Home tab) does not. Matching is derived
 * from the registries rather than from path prefixes because a console's items
 * deliberately span several route namespaces.
 */
const matchRegistry = <T,>(
  pathname: string,
  entries: { owner: T; items: NavItem[] }[],
): T | null => {
  let best: { owner: T; length: number } | null = null;

  for (const entry of entries) {
    for (const item of entry.items) {
      if (!isPathActive(item, pathname)) {
        continue;
      }

      if (!best || item.to.length > best.length) {
        best = { owner: entry.owner, length: item.to.length };
      }
    }
  }

  return best?.owner ?? null;
};

export const resolveConsole = (pathname: string): ConsoleDef | null =>
  matchRegistry(
    pathname,
    CONSOLES.map((def) => ({
      owner: def,
      items: def.groups.flatMap((group) => group.items),
    })),
  );

export const resolveSurface = (pathname: string): SurfaceDef | null =>
  matchRegistry(
    pathname,
    SURFACES.map((surface) => ({ owner: surface, items: surface.tabs })),
  );

/** True when the pathname sits anywhere inside the given console. */
export const isConsoleActive = (def: ConsoleDef, pathname: string): boolean =>
  resolveConsole(pathname)?.id === def.id;

/**
 * A primary nav row is active when its own path matches, or when the pathname
 * belongs to the surface that row opens. Without the second half, standing on
 * the `Processing` tab would leave every sidebar row unlit.
 */
/** The most specific item in a list that matches the pathname. */
const bestMatch = (items: NavItem[], pathname: string): NavItem | undefined =>
  items
    .filter((item) => isPathActive(item, pathname))
    .sort((a, b) => b.to.length - a.to.length)[0];

/**
 * Breadcrumb trail for a pathname, drawn from the same registries as the nav.
 *
 * Derived rather than hand-maintained on purpose: the topbar used to keep its
 * own path-segment-to-label map, which had drifted out of date and fell back to
 * capitalising the raw segment — so `/org` announced itself as "Org", a word
 * that appears nowhere in the product. A label can now only change in one place.
 *
 * Returns an empty trail for paths the registries do not own (document detail,
 * editors), leaving the caller to name those itself.
 */
export const resolveBreadcrumb = (pathname: string): React.ReactNode[] => {
  const consoleDef = resolveConsole(pathname);

  if (consoleDef) {
    const item = bestMatch(
      consoleDef.groups.flatMap((group) => group.items),
      pathname,
    );

    return item ? [consoleDef.title, item.label] : [consoleDef.title];
  }

  const surface = resolveSurface(pathname);

  if (surface) {
    const tab = bestMatch(surface.tabs, pathname);

    // A surface whose only view repeats its own name reads as "Inbox › Inbox".
    return tab && surface.tabs.length > 1 ? [surface.title, tab.label] : [surface.title];
  }

  const item = bestMatch([...PRIMARY_NAV, ...TOOLS_NAV], pathname);

  return item ? [item.label] : [];
};

export const isPrimaryItemActive = (item: NavItem, pathname: string): boolean => {
  // A console owns the pathname, so no daily-work row should claim it. Without
  // this, standing on `/org/settings` would light `Home`, whose `/org` prefix
  // otherwise looks like a match.
  if (resolveConsole(pathname)) {
    return false;
  }

  if (item.surface) {
    return resolveSurface(pathname)?.id === item.surface;
  }

  return isPathActive(item, pathname);
};
