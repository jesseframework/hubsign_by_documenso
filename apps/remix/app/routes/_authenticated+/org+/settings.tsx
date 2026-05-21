import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { BuildingIcon, PencilIcon, PlusIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Settings');
}

export default function OrgSettingsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();

  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [brandInitialized, setBrandInitialized] = useState(false);
  const [brandPrimary, setBrandPrimary] = useState('#7c5cfc');
  const [brandAccent, setBrandAccent] = useState('#f59e0b');
  const [brandSidebarBg, setBrandSidebarBg] = useState('#0d0d10');
  const [brandSidebarText, setBrandSidebarText] = useState('#f4f2ff');
  const [brandNavActive, setBrandNavActive] = useState('#7c5cfc');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandButtonColor, setBrandButtonColor] = useState('#7c5cfc');
  const [brandButtonHover, setBrandButtonHover] = useState('#6a4af0');
  const [brandButtonText, setBrandButtonText] = useState('#ffffff');

  // Email domain restriction
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [domainsInitialized, setDomainsInitialized] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  // Sign reminders
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDays, setReminderDays] = useState(3);
  const [reminderMaxCount, setReminderMaxCount] = useState(3);
  const [remindersInitialized, setRemindersInitialized] = useState(false);

  // SSO / OIDC
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcWellKnownUrl, setOidcWellKnownUrl] = useState('');
  const [oidcProviderLabel, setOidcProviderLabel] = useState('');
  const [disableSelfSignup, setDisableSelfSignup] = useState(false);
  const [ssoInitialized, setSsoInitialized] = useState(false);

  // Email-to-sign
  const [emailToSignEnabled, setEmailToSignEnabled] = useState(false);
  const [emailToSignInitialized, setEmailToSignInitialized] = useState(false);
  // Per-org WorkHub signature-inbox (receive) config
  const [inboxEmail, setInboxEmail] = useState('');
  const [workhubUsername, setWorkhubUsername] = useState('');
  const [workhubPassword, setWorkhubPassword] = useState('');
  const [workhubMailboxId, setWorkhubMailboxId] = useState('');
  const [workhubApiBase, setWorkhubApiBase] = useState('');

  // OCR settings
  const [ocrApiUrl, setOcrApiUrl] = useState('');
  const [ocrApiKey, setOcrApiKey] = useState('');
  const [ocrUsername, setOcrUsername] = useState('');
  const [ocrPassword, setOcrPassword] = useState('');
  const [ocrEngine, setOcrEngine] = useState('');
  const [ocrAutoProcess, setOcrAutoProcess] = useState(false);
  const [ocrLoaded, setOcrLoaded] = useState(false);

  const createOrg = trpc.org.create.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      toast({ title: _(msg`Organization created`) });
    },
  });

  const updateOrg = trpc.org.update.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      toast({ title: _(msg`Organization updated`) });
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  }

  // No organization yet — show create form
  if (!membership) {
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--r)] border border-border bg-card p-6">
          <div className="mx-auto max-w-md text-center">
            <BuildingIcon className="mx-auto mb-4 h-12 w-12 text-primary/30" />
            <h2 className="text-xl font-semibold"><Trans>Create an Organization</Trans></h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              <Trans>Organizations let you share the Document Manager across your team with role-based permissions.</Trans>
            </p>

            <div className="mt-6 space-y-3 text-left">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Organization Name</label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Acme Corporation"
                  value={createName}
                  onChange={(e) => {
                    setCreateName(e.target.value);
                    setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
                  }}
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">URL Slug</label>
                <Input
                  className="mt-1"
                  placeholder="acme-corp"
                  value={createSlug}
                  onChange={(e) => setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">hubsign.io/org/{createSlug || '...'}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => void createOrg.mutateAsync({ name: createName, slug: createSlug })}
                disabled={!createName || !createSlug || createOrg.isPending}
                loading={createOrg.isPending}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                <Trans>Create Organization</Trans>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const org = membership.organization;
  const isAdmin = membership.role === 'ORG_ADMIN';

  // Initialize branding state from org data (once)
  if (!brandInitialized && org) {
    setBrandPrimary(org.brandingPrimaryColor || '#7c5cfc');
    setBrandAccent(org.brandingAccentColor || '#f59e0b');
    setBrandSidebarBg(org.brandingSidebarBg || '#0d0d10');
    setBrandSidebarText(org.brandingSidebarTextColor || '#f4f2ff');
    setBrandNavActive((org as Record<string, unknown>).brandingNavActiveColor as string || org.brandingPrimaryColor || '#7c5cfc');
    setBrandLogoUrl(org.brandingLogo || '');
    setBrandButtonColor(org.brandingButtonColor || '#7c5cfc');
    setBrandButtonHover(org.brandingButtonHoverColor || '#6a4af0');
    setBrandButtonText(org.brandingButtonTextColor || '#ffffff');
    setBrandInitialized(true);
  }

  if (!domainsInitialized && org) {
    setAllowedDomains(((org as Record<string, unknown>).allowedEmailDomains as string[]) ?? []);
    setDomainsInitialized(true);
  }

  if (!remindersInitialized && org) {
    const orgRec = org as Record<string, unknown>;
    setReminderEnabled(Boolean(orgRec.signReminderEnabled));
    setReminderDays(typeof orgRec.signReminderDays === 'number' ? orgRec.signReminderDays : 3);
    setReminderMaxCount(typeof orgRec.signReminderMaxCount === 'number' ? orgRec.signReminderMaxCount : 3);
    setRemindersInitialized(true);
  }

  if (!ssoInitialized && org) {
    const orgRec = org as Record<string, unknown>;
    setOidcEnabled(Boolean(orgRec.oidcEnabled));
    setOidcClientId((orgRec.oidcClientId as string) ?? '');
    setOidcClientSecret((orgRec.oidcClientSecret as string) ?? '');
    setOidcWellKnownUrl((orgRec.oidcWellKnownUrl as string) ?? '');
    setOidcProviderLabel((orgRec.oidcProviderLabel as string) ?? '');
    setDisableSelfSignup(Boolean(orgRec.disableSelfSignup));
    setSsoInitialized(true);
  }

  if (!emailToSignInitialized && org) {
    const o = org as Record<string, unknown>;
    setEmailToSignEnabled(Boolean(o.emailToSignEnabled));
    setInboxEmail((o.inboxEmail as string) ?? '');
    setWorkhubUsername((o.workhubUsername as string) ?? '');
    setWorkhubPassword((o.workhubPassword as string) ?? '');
    setWorkhubMailboxId((o.workhubMailboxId as string) ?? '');
    setWorkhubApiBase((o.workhubApiBase as string) ?? '');
    setEmailToSignInitialized(true);
  }

  const addDomain = () => {
    const cleaned = newDomain.trim().toLowerCase().replace(/^@/, '');
    if (!cleaned) return;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(cleaned)) {
      toast({
        title: _(msg`Invalid domain`),
        description: _(msg`Use a valid format like "example.com"`),
        variant: 'destructive',
      });
      return;
    }
    if (allowedDomains.includes(cleaned)) return;
    setAllowedDomains([...allowedDomains, cleaned]);
    setNewDomain('');
  };

  const removeDomain = (d: string) => {
    setAllowedDomains(allowedDomains.filter((x) => x !== d));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold"><Trans>Organization Details</Trans></h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              <Trans>Manage your organization settings.</Trans>
            </p>
          </div>
          {isAdmin && !editingDetails && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setEditName(org.name);
                setEditDomain(org.domain || '');
                setEditingDetails(true);
              }}
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>

        {editingDetails ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Name</label>
                <Input
                  className="mt-1 h-9 text-[13px]"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Organization name"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Domain</label>
                <Input
                  className="mt-1 h-9 text-[13px]"
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  placeholder="e.g. acme.com"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Used for SSO and email domain matching</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Slug</label>
                <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">{org.slug}</p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Your Role</label>
                <p className="mt-0.5 text-[13px] font-medium text-primary">{membership.role.replace(/_/g, ' ')}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditingDetails(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void updateOrg.mutateAsync({
                    name: editName || undefined,
                    domain: editDomain || null,
                  }).then(() => setEditingDetails(false));
                }}
                loading={updateOrg.isPending}
                disabled={!editName.trim()}
              >
                Save Changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Name</label>
              <p className="mt-0.5 text-[14px] font-medium">{org.name}</p>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Slug</label>
              <p className="mt-0.5 font-mono text-[13px]">{org.slug}</p>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Your Role</label>
              <p className="mt-0.5 text-[13px] font-medium text-primary">{membership.role.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Domain</label>
              <p className="mt-0.5 text-[13px]">{org.domain || 'Not set'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Members</span>
          <p className="mt-1 text-2xl font-semibold">{org.members.length}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">DMS Documents</span>
          <p className="mt-1 text-2xl font-semibold">{org._count.dmsDocuments}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Locations</span>
          <p className="mt-1 text-2xl font-semibold">{org._count.dmsLocations}</p>
        </div>
      </div>

      {/* Branding */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold"><Trans>Organization Branding</Trans></h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>Customize your organization's appearance with your brand colors and logo.</Trans>
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* Primary Color */}
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Primary Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandPrimary}
                  onChange={(e) => { setBrandPrimary(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandPrimary}
                  onChange={(e) => { setBrandPrimary(e.target.value);}}
                  placeholder="#7c5cfc"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Used for buttons, active states, and highlights</p>
            </div>

            {/* Accent Color */}
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Accent Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandAccent}
                  onChange={(e) => { setBrandAccent(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandAccent}
                  onChange={(e) => { setBrandAccent(e.target.value);}}
                  placeholder="#f59e0b"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Used for secondary highlights and accents</p>
            </div>
          </div>

          {/* Sidebar Colors */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Sidebar Background</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandSidebarBg}
                  onChange={(e) => { setBrandSidebarBg(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandSidebarBg}
                  onChange={(e) => { setBrandSidebarBg(e.target.value);}}
                  placeholder="#0d0d10"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Sidebar Text Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandSidebarText}
                  onChange={(e) => { setBrandSidebarText(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandSidebarText}
                  onChange={(e) => { setBrandSidebarText(e.target.value);}}
                  placeholder="#f4f2ff"
                />
              </div>
            </div>
          </div>

          {/* Nav Active Color */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Nav Selected/Active Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandNavActive}
                  onChange={(e) => setBrandNavActive(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandNavActive}
                  onChange={(e) => setBrandNavActive(e.target.value)}
                  placeholder="#7c5cfc"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Color for the active/selected menu item in the sidebar</p>
            </div>
          </div>

          {/* Button Colors */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Button Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandButtonColor}
                  onChange={(e) => { setBrandButtonColor(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandButtonColor}
                  onChange={(e) => { setBrandButtonColor(e.target.value);}}
                  placeholder="#7c5cfc"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Button Hover Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandButtonHover}
                  onChange={(e) => { setBrandButtonHover(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandButtonHover}
                  onChange={(e) => { setBrandButtonHover(e.target.value);}}
                  placeholder="#6a4af0"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Button Text Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandButtonText}
                  onChange={(e) => { setBrandButtonText(e.target.value);}}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandButtonText}
                  onChange={(e) => { setBrandButtonText(e.target.value);}}
                  placeholder="#ffffff"
                />
              </div>
            </div>
          </div>

          {/* Logo URL */}
          <div className="mt-4">
            <label className="text-[12px] font-medium text-muted-foreground">Organization Logo URL</label>
            <Input
              className="mt-1.5 h-9 text-[13px]"
              value={brandLogoUrl}
              onChange={(e) => { setBrandLogoUrl(e.target.value);}}
              placeholder="https://example.com/logo.png (or leave empty for default)"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">PNG or SVG recommended. Will replace the HubSign logo in the sidebar.</p>
          </div>

          {/* Preview */}
          <div className="mt-4">
            <label className="text-[12px] font-medium text-muted-foreground">Preview</label>
            <div className="mt-1.5 flex gap-3 overflow-hidden rounded-md border border-border">
              {/* Sidebar preview */}
              <div
                className="flex w-[180px] flex-shrink-0 flex-col p-3"
                style={{
                  background: brandSidebarBg,
                  color: brandSidebarText,
                }}
              >
                {brandLogoUrl ? (
                  <img
                    src={brandLogoUrl}
                    alt="Logo"
                    className="mb-3 h-6 w-auto object-contain"
                    style={{ filter: 'brightness(0) invert(1)' }}
                  />
                ) : (
                  <p className="mb-3 text-[13px] font-semibold">{org.name}</p>
                )}
                <div className="space-y-1">
                  <div
                    className="rounded px-2 py-1 text-[11px] font-medium"
                    style={{ background: `${brandPrimary}22`, color: brandPrimary }}
                  >
                    Documents
                  </div>
                  <div className="rounded px-2 py-1 text-[11px]" style={{ opacity: 0.6 }}>Templates</div>
                  <div className="rounded px-2 py-1 text-[11px]" style={{ opacity: 0.6 }}>Doc Manager</div>
                </div>
              </div>

              {/* Content preview */}
              <div className="flex-1 bg-background p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[12px] font-bold text-white"
                    style={{ background: brandPrimary }}
                  >
                    {org.name[0]}
                  </div>
                  <p className="text-[13px] font-semibold">{org.name}</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors"
                    style={{
                      background: brandButtonColor,
                      color: brandButtonText,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = brandButtonHover;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = brandButtonColor;
                    }}
                  >
                    Button
                  </button>
                  <button
                    className="rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors"
                    style={{
                      background: brandButtonHover,
                      color: brandButtonText,
                    }}
                  >
                    Hover State
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void updateOrg.mutateAsync({
                brandingPrimaryColor: brandPrimary || null,
                brandingAccentColor: brandAccent || null,
                brandingSidebarBg: brandSidebarBg || null,
                brandingSidebarTextColor: brandSidebarText || null,
                brandingNavActiveColor: brandNavActive || null,
                brandingButtonColor: brandButtonColor || null,
                brandingButtonHoverColor: brandButtonHover || null,
                brandingButtonTextColor: brandButtonText || null,
                brandingLogo: brandLogoUrl || null,
              })}
              loading={updateOrg.isPending}
            >
              <Trans>Save Branding</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* Email Domain Restriction */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold"><Trans>Email Domain Restriction</Trans></h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              Only users whose email matches one of these domains can be invited or self-join
              this organization. Leave empty to allow any email.
            </Trans>
          </p>

          <div className="mt-4 flex gap-2">
            <Input
              className="h-8 flex-1 text-[13px]"
              placeholder="e.g. acme.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDomain();
                }
              }}
            />
            <Button size="sm" onClick={addDomain} disabled={!newDomain.trim()}>
              <PlusIcon className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {allowedDomains.length === 0 ? (
              <p className="text-[12px] italic text-muted-foreground">
                <Trans>No restriction — any email domain can be invited.</Trans>
              </p>
            ) : (
              allowedDomains.map((d) => (
                <span
                  key={d}
                  className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[12px] font-medium"
                >
                  @{d}
                  <button
                    type="button"
                    className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-600 group-hover:opacity-100"
                    onClick={() => removeDomain(d)}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void updateOrg.mutateAsync({ allowedEmailDomains: allowedDomains })}
              loading={updateOrg.isPending}
            >
              <Trans>Save Domain Restrictions</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* Sign Reminders */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold"><Trans>Sign Reminders</Trans></h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              Automatically email recipients who haven't signed yet after the chosen number of
              days. Reminders stop after the maximum count is reached.
            </Trans>
          </p>

          <div className="mt-4 flex items-start justify-between rounded-md border border-border p-3">
            <div className="flex-1 pr-4">
              <label className="text-[13px] font-medium">
                <Trans>Enable sign reminders</Trans>
              </label>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <Trans>
                  Requires a scheduled cron to call <code>POST /api/cron/send-reminders</code>.
                </Trans>
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
              />
              <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-border after:bg-background after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-primary" />
            </label>
          </div>

          {reminderEnabled && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>Reminder interval (days)</Trans>
                </label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  className="mt-1 h-8 text-[13px]"
                  value={reminderDays}
                  onChange={(e) => setReminderDays(Math.max(1, Math.min(60, Number(e.target.value))))}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Send a reminder if the recipient still hasn't signed after this many days.
                </p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>Max reminders per recipient</Trans>
                </label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  className="mt-1 h-8 text-[13px]"
                  value={reminderMaxCount}
                  onChange={(e) => setReminderMaxCount(Math.max(1, Math.min(10, Number(e.target.value))))}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stops sending reminders after this many.
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void updateOrg.mutateAsync({
                signReminderEnabled: reminderEnabled,
                signReminderDays: reminderDays,
                signReminderMaxCount: reminderMaxCount,
              })}
              loading={updateOrg.isPending}
            >
              <Trans>Save Reminder Settings</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* SSO / OIDC Configuration */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold"><Trans>Single Sign-On (SSO)</Trans></h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              Configure your own OpenID Connect provider — works with Office 365 / Azure AD,
              Google Workspace, Okta, Auth0, or any OIDC-compliant identity provider. When
              enabled, members sign in via{' '}
              <code className="rounded bg-muted px-1">/signin?org={org.slug}</code>.
            </Trans>
          </p>

          <div className="mt-4 flex items-start justify-between rounded-md border border-border p-3">
            <div className="flex-1 pr-4">
              <label className="text-[13px] font-medium">
                <Trans>Enable SSO for this organization</Trans>
              </label>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <Trans>
                  When on, the SSO button appears on{' '}
                  <code className="rounded bg-muted px-1">/signin?org={org.slug}</code>. New
                  members are auto-added to this org on first SSO sign-in.
                </Trans>
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={oidcEnabled}
                onChange={(e) => setOidcEnabled(e.target.checked)}
              />
              <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-border after:bg-background after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-primary" />
            </label>
          </div>

          {oidcEnabled && (
            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>Provider Label</Trans>
                </label>
                <Input
                  className="mt-1 h-9 text-[13px]"
                  placeholder='Shown on the SSO button (e.g. "Sign in with Acme")'
                  value={oidcProviderLabel}
                  onChange={(e) => setOidcProviderLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>Discovery / Well-Known URL</Trans>
                </label>
                <Input
                  className="mt-1 h-9 font-mono text-[13px]"
                  placeholder="https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration"
                  value={oidcWellKnownUrl}
                  onChange={(e) => setOidcWellKnownUrl(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Office 365: <code>https://login.microsoftonline.com/{'{tenant-id}'}/v2.0/.well-known/openid-configuration</code>
                  <br />
                  Google Workspace: <code>https://accounts.google.com/.well-known/openid-configuration</code>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground">
                    <Trans>Client ID</Trans>
                  </label>
                  <Input
                    className="mt-1 h-9 font-mono text-[13px]"
                    value={oidcClientId}
                    onChange={(e) => setOidcClientId(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground">
                    <Trans>Client Secret</Trans>
                  </label>
                  <Input
                    className="mt-1 h-9 font-mono text-[13px]"
                    type="password"
                    value={oidcClientSecret}
                    onChange={(e) => setOidcClientSecret(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                <Trans>
                  Set the redirect URL on your provider to:{' '}
                  <code className="rounded bg-muted px-1">
                    {typeof window !== 'undefined' ? window.location.origin : 'https://app.hubsign.io'}
                    /api/auth/callback/oidc?org={org.slug}
                  </code>
                </Trans>
              </p>
            </div>
          )}

          <div className="mt-4 flex items-start justify-between rounded-md border border-border p-3">
            <div className="flex-1 pr-4">
              <label className="text-[13px] font-medium">
                <Trans>Disable self-signup for this organization's domains</Trans>
              </label>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <Trans>
                  Users with an email matching one of this org's allowed domains can't sign up
                  themselves — they must be invited or use SSO. Set allowed domains above first.
                </Trans>
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={disableSelfSignup}
                onChange={(e) => setDisableSelfSignup(e.target.checked)}
              />
              <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-border after:bg-background after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-primary" />
            </label>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void updateOrg.mutateAsync({
                oidcEnabled,
                oidcClientId: oidcClientId || null,
                oidcClientSecret: oidcClientSecret || null,
                oidcWellKnownUrl: oidcWellKnownUrl || null,
                oidcProviderLabel: oidcProviderLabel || null,
                disableSelfSignup,
              })}
              loading={updateOrg.isPending}
            >
              <Trans>Save SSO Settings</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* Email-to-Sign Inbox */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold"><Trans>Email-to-Sign Inbox</Trans></h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              Forward a PDF to your org's inbox alias and HubSign creates a DRAFT signing
              request automatically. The sender (you or any org member) then opens HubSign to
              add recipients and send it out.
            </Trans>
          </p>

          <div className="mt-4 flex items-start justify-between rounded-md border border-border p-3">
            <div className="flex-1 pr-4">
              <label className="text-[13px] font-medium">
                <Trans>Enable email-to-sign for this org</Trans>
              </label>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <Trans>
                  Inbox alias: <code className="rounded bg-muted px-1">{org.slug}@inbox.hubsign.io</code>
                  &nbsp;(requires DNS + inbound provider config — see README).
                </Trans>
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={emailToSignEnabled}
                onChange={(e) => setEmailToSignEnabled(e.target.checked)}
              />
              <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-border after:bg-background after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-primary" />
            </label>
          </div>

          {/* WorkHub inbox (receive) connection — per org, same credential model as sending */}
          <div className="mt-4 space-y-3">
            <p className="text-[12px] font-medium text-muted-foreground">
              <Trans>WorkHub inbox connection</Trans>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>Inbox email (receiving address)</Trans>
                </label>
                <input
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                  value={inboxEmail}
                  onChange={(e) => setInboxEmail(e.target.value)}
                  placeholder={`${org.slug}@inbox.your-domain.com`}
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>Mailbox ID (optional)</Trans>
                </label>
                <input
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                  value={workhubMailboxId}
                  onChange={(e) => setWorkhubMailboxId(e.target.value)}
                  placeholder="leave blank to use the credential's mailbox"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>WorkHub BulkSender username</Trans>
                </label>
                <input
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                  value={workhubUsername}
                  onChange={(e) => setWorkhubUsername(e.target.value)}
                  placeholder="bsk_..."
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>WorkHub BulkSender password</Trans>
                </label>
                <input
                  type="password"
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                  value={workhubPassword}
                  onChange={(e) => setWorkhubPassword(e.target.value)}
                  placeholder="bsk...."
                  autoComplete="new-password"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[12px] font-medium text-muted-foreground">
                  <Trans>WorkHub API base (optional)</Trans>
                </label>
                <input
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                  value={workhubApiBase}
                  onChange={(e) => setWorkhubApiBase(e.target.value)}
                  placeholder="https://api.workhubplatform.io/v1 (or staging)"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              <Trans>
                Uses your org's WorkHub BulkSender credential (same as sending) to poll its mailbox.
                The signature inbox shows incoming PDFs after OCR.
              </Trans>
            </p>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() =>
                void updateOrg.mutateAsync({
                  emailToSignEnabled,
                  inboxEmail: inboxEmail || null,
                  workhubUsername: workhubUsername || null,
                  workhubPassword: workhubPassword || null,
                  workhubMailboxId: workhubMailboxId || null,
                  workhubApiBase: workhubApiBase || null,
                })
              }
              loading={updateOrg.isPending}
            >
              <Trans>Save Inbox Settings</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* OCR / BMS ML Settings */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold"><Trans>OCR & Document Processing</Trans></h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>Connect your BMS ML service for automatic OCR, field extraction, and document classification.</Trans>
          </p>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">BMS ML API URL</label>
                <Input
                  className="mt-1.5 h-9 font-mono text-[13px]"
                  value={ocrApiUrl}
                  onChange={(e) => { setOcrApiUrl(e.target.value); }}
                  placeholder="http://bms-ml-server:8080/api/v1"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">The base URL of your BMS ML service</p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">API Key</label>
                <Input
                  className="mt-1.5 h-9 font-mono text-[13px]"
                  type="password"
                  value={ocrApiKey}
                  onChange={(e) => { setOcrApiKey(e.target.value); }}
                  placeholder="sk-your-api-key"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Authentication key for the BMS ML API</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Username (JWT auth)</label>
                <Input
                  className="mt-1.5 h-9 text-[13px]"
                  value={ocrUsername}
                  onChange={(e) => { setOcrUsername(e.target.value); }}
                  placeholder="admin"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Leave empty if using API key</p>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Password (JWT auth)</label>
                <Input
                  className="mt-1.5 h-9 text-[13px]"
                  type="password"
                  value={ocrPassword}
                  onChange={(e) => { setOcrPassword(e.target.value); }}
                  placeholder="••••••"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Leave empty if using API key</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Default OCR Engine</label>
                <select
                  className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-2 text-[13px]"
                  value={ocrEngine}
                  onChange={(e) => { setOcrEngine(e.target.value); }}
                >
                  <option value="auto">Auto-detect (recommended)</option>
                  <option value="doctr">DocTR (deep learning)</option>
                  <option value="easyocr">EasyOCR (multi-language)</option>
                  <option value="tesseract">Tesseract (fast)</option>
                  <option value="pymupdf">PyMuPDF (text PDFs)</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={ocrAutoProcess}
                    onChange={(e) => { setOcrAutoProcess(e.target.checked); }}
                  />
                  <span className="text-[13px] font-medium">Auto-process on upload</span>
                </label>
                <p className="ml-6 text-[11px] text-muted-foreground">Automatically run OCR when documents are uploaded</p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => void updateOrg.mutateAsync({
                  ocrApiUrl: ocrApiUrl || null,
                  ocrApiKey: ocrApiKey || null,
                  ocrApiUsername: ocrUsername || null,
                  ocrApiPassword: ocrPassword || null,
                  ocrDefaultEngine: ocrEngine || null,
                  ocrAutoProcess,
                })}
                loading={updateOrg.isPending}
              >
                <Trans>Save OCR Settings</Trans>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
