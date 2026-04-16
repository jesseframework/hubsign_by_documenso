import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { BuildingIcon, PlusIcon } from 'lucide-react';

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
  const [brandPrimary, setBrandPrimary] = useState('');
  const [brandAccent, setBrandAccent] = useState('');
  const [brandSidebarBg, setBrandSidebarBg] = useState('');
  const [brandSidebarText, setBrandSidebarText] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandButtonColor, setBrandButtonColor] = useState('');
  const [brandButtonHover, setBrandButtonHover] = useState('');
  const [brandButtonText, setBrandButtonText] = useState('');
  const [brandLoaded, setBrandLoaded] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <h2 className="text-[15px] font-semibold"><Trans>Organization Details</Trans></h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>Manage your organization settings.</Trans>
        </p>

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
                  value={brandLoaded ? brandPrimary : (org.brandingPrimaryColor || '#7c5cfc')}
                  onChange={(e) => { setBrandPrimary(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandPrimary : (org.brandingPrimaryColor || '#7c5cfc')}
                  onChange={(e) => { setBrandPrimary(e.target.value); setBrandLoaded(true); }}
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
                  value={brandLoaded ? brandAccent : (org.brandingAccentColor || '#f59e0b')}
                  onChange={(e) => { setBrandAccent(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandAccent : (org.brandingAccentColor || '#f59e0b')}
                  onChange={(e) => { setBrandAccent(e.target.value); setBrandLoaded(true); }}
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
                  value={brandLoaded ? brandSidebarBg : (org.brandingSidebarBg || '#0d0d10')}
                  onChange={(e) => { setBrandSidebarBg(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandSidebarBg : (org.brandingSidebarBg || '#0d0d10')}
                  onChange={(e) => { setBrandSidebarBg(e.target.value); setBrandLoaded(true); }}
                  placeholder="#0d0d10"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Sidebar Text Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandLoaded ? brandSidebarText : (org.brandingSidebarTextColor || '#f4f2ff')}
                  onChange={(e) => { setBrandSidebarText(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandSidebarText : (org.brandingSidebarTextColor || '#f4f2ff')}
                  onChange={(e) => { setBrandSidebarText(e.target.value); setBrandLoaded(true); }}
                  placeholder="#f4f2ff"
                />
              </div>
            </div>
          </div>

          {/* Button Colors */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Button Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandLoaded ? brandButtonColor : (org.brandingButtonColor || '#7c5cfc')}
                  onChange={(e) => { setBrandButtonColor(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandButtonColor : (org.brandingButtonColor || '#7c5cfc')}
                  onChange={(e) => { setBrandButtonColor(e.target.value); setBrandLoaded(true); }}
                  placeholder="#7c5cfc"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Button Hover Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandLoaded ? brandButtonHover : (org.brandingButtonHoverColor || '#6a4af0')}
                  onChange={(e) => { setBrandButtonHover(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandButtonHover : (org.brandingButtonHoverColor || '#6a4af0')}
                  onChange={(e) => { setBrandButtonHover(e.target.value); setBrandLoaded(true); }}
                  placeholder="#6a4af0"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Button Text Color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={brandLoaded ? brandButtonText : (org.brandingButtonTextColor || '#ffffff')}
                  onChange={(e) => { setBrandButtonText(e.target.value); setBrandLoaded(true); }}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <Input
                  className="h-9 flex-1 font-mono text-[13px]"
                  value={brandLoaded ? brandButtonText : (org.brandingButtonTextColor || '#ffffff')}
                  onChange={(e) => { setBrandButtonText(e.target.value); setBrandLoaded(true); }}
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
              value={brandLoaded ? brandLogoUrl : (org.brandingLogo || '')}
              onChange={(e) => { setBrandLogoUrl(e.target.value); setBrandLoaded(true); }}
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
                  background: brandLoaded ? brandSidebarBg : (org.brandingSidebarBg || '#0d0d10'),
                  color: brandLoaded ? brandSidebarText : (org.brandingSidebarTextColor || '#f4f2ff'),
                }}
              >
                {(brandLoaded ? brandLogoUrl : org.brandingLogo) ? (
                  <img
                    src={brandLoaded ? brandLogoUrl : (org.brandingLogo || '')}
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
                    style={{ background: `${brandLoaded ? brandPrimary : (org.brandingPrimaryColor || '#7c5cfc')}22`, color: brandLoaded ? brandPrimary : (org.brandingPrimaryColor || '#7c5cfc') }}
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
                    style={{ background: brandLoaded ? brandPrimary : (org.brandingPrimaryColor || '#7c5cfc') }}
                  >
                    {org.name[0]}
                  </div>
                  <p className="text-[13px] font-semibold">{org.name}</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors"
                    style={{
                      background: brandLoaded ? brandButtonColor : (org.brandingButtonColor || '#7c5cfc'),
                      color: brandLoaded ? brandButtonText : (org.brandingButtonTextColor || '#ffffff'),
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = brandLoaded ? brandButtonHover : (org.brandingButtonHoverColor || '#6a4af0');
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = brandLoaded ? brandButtonColor : (org.brandingButtonColor || '#7c5cfc');
                    }}
                  >
                    Button
                  </button>
                  <button
                    className="rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors"
                    style={{
                      background: brandLoaded ? brandButtonHover : (org.brandingButtonHoverColor || '#6a4af0'),
                      color: brandLoaded ? brandButtonText : (org.brandingButtonTextColor || '#ffffff'),
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
    </div>
  );
}
