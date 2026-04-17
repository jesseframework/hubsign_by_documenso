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
