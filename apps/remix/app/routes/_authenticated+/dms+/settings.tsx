import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { PlusIcon, Trash2Icon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('DMS Settings');
}

export default function DmsSettingsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [newTypeName, setNewTypeName] = useState('');
  const [newClassName, setNewClassName] = useState('');
  const [newTagName, setNewTagName] = useState('');

  // Auto-filing settings
  const { data: autoFilingSettings } = trpc.dms.getAutoFilingSettings.useQuery();
  const { data: locations } = trpc.dms.getLocations.useQuery();
  const [afEnabled, setAfEnabled] = useState(false);
  const [afBinId, setAfBinId] = useState('');
  const [afTypeId, setAfTypeId] = useState('');
  const [afClassId, setAfClassId] = useState('');
  const [afConfidentiality, setAfConfidentiality] = useState('INTERNAL');
  const [afAutoOcr, setAfAutoOcr] = useState(true);
  const [afLoaded, setAfLoaded] = useState(false);

  // Load settings when data arrives
  if (autoFilingSettings && !afLoaded) {
    setAfEnabled(autoFilingSettings.enabled);
    setAfBinId(autoFilingSettings.binId || '');
    setAfTypeId(autoFilingSettings.documentTypeId || '');
    setAfClassId(autoFilingSettings.classificationId || '');
    setAfConfidentiality(autoFilingSettings.confidentiality);
    setAfAutoOcr(autoFilingSettings.autoOcr);
    setAfLoaded(true);
  }

  // Flatten bins
  const allBins: { id: string; path: string }[] = [];
  locations?.forEach((loc) =>
    loc.cabinets.forEach((cab) =>
      cab.shelves.forEach((shelf) =>
        shelf.bins.forEach((bin) =>
          allBins.push({ id: bin.id, path: `${loc.name} › ${cab.name} › ${shelf.name} › ${bin.name}` }),
        ),
      ),
    ),
  );

  const saveAutoFiling = trpc.dms.saveAutoFilingSettings.useMutation({
    onSuccess: () => {
      void utils.dms.getAutoFilingSettings.invalidate();
      toast({ title: _(msg`Auto-filing settings saved`) });
    },
  });

  const { data: types } = trpc.dms.getDocumentTypes.useQuery();
  const { data: classifications } = trpc.dms.getClassifications.useQuery();
  const { data: tags } = trpc.dms.getTags.useQuery();

  const createType = trpc.dms.createDocumentType.useMutation({
    onSuccess: () => {
      void utils.dms.getDocumentTypes.invalidate();
      setNewTypeName('');
      toast({ title: _(msg`Document type created`) });
    },
  });

  const createClassification = trpc.dms.createClassification.useMutation({
    onSuccess: () => {
      void utils.dms.getClassifications.invalidate();
      setNewClassName('');
      toast({ title: _(msg`Classification created`) });
    },
  });

  const createTag = trpc.dms.createTag.useMutation({
    onSuccess: () => {
      void utils.dms.getTags.invalidate();
      setNewTagName('');
      toast({ title: _(msg`Tag created`) });
    },
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">
        <Trans>DMS Settings</Trans>
      </h2>

      {/* Auto-Filing Settings */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold">
              <Trans>Auto-File Signed Documents</Trans>
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              <Trans>Automatically file completed signed documents from HubSign into the Document Manager.</Trans>
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={afEnabled}
              onChange={(e) => setAfEnabled(e.target.checked)}
            />
            <span className="text-[13px] font-medium">{afEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>

        {afEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Filing Location</label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-[13px]"
                value={afBinId}
                onChange={(e) => setAfBinId(e.target.value)}
              >
                <option value="">Unfiled (no location)</option>
                {allBins.map((b) => <option key={b.id} value={b.id}>{b.path}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Document Type</label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-[13px]"
                value={afTypeId}
                onChange={(e) => setAfTypeId(e.target.value)}
              >
                <option value="">No type</option>
                {types?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Classification</label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-[13px]"
                value={afClassId}
                onChange={(e) => setAfClassId(e.target.value)}
              >
                <option value="">No classification</option>
                {classifications?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Confidentiality</label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-[13px]"
                value={afConfidentiality}
                onChange={(e) => setAfConfidentiality(e.target.value)}
              >
                <option value="PUBLIC">Public</option>
                <option value="INTERNAL">Internal</option>
                <option value="CONFIDENTIAL">Confidential</option>
                <option value="RESTRICTED">Restricted</option>
              </select>
            </div>

            <div className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-border"
                checked={afAutoOcr}
                onChange={(e) => setAfAutoOcr(e.target.checked)}
              />
              <span className="text-[13px]">Auto-OCR signed documents after filing</span>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={() => void saveAutoFiling.mutateAsync({
              enabled: afEnabled,
              binId: afBinId || null,
              documentTypeId: afTypeId || null,
              classificationId: afClassId || null,
              confidentiality: afConfidentiality as 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED',
              autoOcr: afAutoOcr,
            })}
            loading={saveAutoFiling.isPending}
          >
            <Trans>Save Settings</Trans>
          </Button>
        </div>
      </div>

      {/* Document Types */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">
          <Trans>Document Types</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>Define the types of documents in your system (Invoice, Contract, ID, etc.)</Trans>
        </p>

        <div className="mt-4 flex gap-2">
          <Input
            className="h-8 text-[13px]"
            placeholder="New document type..."
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => createType.mutate({ name: newTypeName })}
            disabled={!newTypeName.trim()}
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Add</Trans>
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {types?.map((type) => (
            <span
              key={type.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-[12px] font-medium"
            >
              {type.name}
            </span>
          ))}
          {(!types || types.length === 0) && (
            <p className="text-[12px] text-muted-foreground">
              <Trans>No document types defined yet</Trans>
            </p>
          )}
        </div>
      </div>

      {/* Classifications */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">
          <Trans>Classifications</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>Categories for organizing documents (HR, Legal, Finance, Operations, etc.)</Trans>
        </p>

        <div className="mt-4 flex gap-2">
          <Input
            className="h-8 text-[13px]"
            placeholder="New classification..."
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => createClassification.mutate({ name: newClassName })}
            disabled={!newClassName.trim()}
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Add</Trans>
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {classifications?.map((cls) => (
            <span
              key={cls.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-[12px] font-medium"
            >
              {cls.name}
              {cls.children.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  ({cls.children.length} sub)
                </span>
              )}
            </span>
          ))}
          {(!classifications || classifications.length === 0) && (
            <p className="text-[12px] text-muted-foreground">
              <Trans>No classifications defined yet</Trans>
            </p>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">
          <Trans>Tags</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>Freeform labels for quick document tagging</Trans>
        </p>

        <div className="mt-4 flex gap-2">
          <Input
            className="h-8 text-[13px]"
            placeholder="New tag..."
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => createTag.mutate({ name: newTagName })}
            disabled={!newTagName.trim()}
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Add</Trans>
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {tags?.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[12px] font-medium text-primary"
            >
              #{tag.name}
            </span>
          ))}
          {(!tags || tags.length === 0) && (
            <p className="text-[12px] text-muted-foreground">
              <Trans>No tags defined yet</Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
