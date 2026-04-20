import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

type EditableChipProps = {
  id: string;
  label: string;
  onSave: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  variant?: 'default' | 'tag';
  prefix?: string;
};

const EditableChip = ({ id, label, onSave, onDelete, variant = 'default', prefix = '' }: EditableChipProps) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);

  const baseClass =
    variant === 'tag'
      ? 'inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary'
      : 'inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[12px] font-medium';

  if (editing) {
    return (
      <span className={`${baseClass} h-7`}>
        <input
          autoFocus
          className="h-5 w-32 rounded border border-border bg-background px-1.5 text-[12px] outline-none focus:border-primary"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              onSave(id, value.trim());
              setEditing(false);
            }
            if (e.key === 'Escape') {
              setValue(label);
              setEditing(false);
            }
          }}
        />
        <button
          className="rounded p-0.5 hover:bg-primary/20"
          onClick={() => {
            if (value.trim()) {
              onSave(id, value.trim());
              setEditing(false);
            }
          }}
          title="Save"
        >
          <CheckIcon className="h-3 w-3" />
        </button>
        <button
          className="rounded p-0.5 hover:bg-muted-foreground/20"
          onClick={() => {
            setValue(label);
            setEditing(false);
          }}
          title="Cancel"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <span className={`${baseClass} group`}>
      {prefix}{label}
      <button
        className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-primary/20 group-hover:opacity-100"
        onClick={() => setEditing(true)}
        title="Edit"
      >
        <PencilIcon className="h-3 w-3" />
      </button>
      <button
        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-600 group-hover:opacity-100"
        onClick={() => {
          if (confirm(`Delete "${label}"?`)) onDelete(id);
        }}
        title="Delete"
      >
        <Trash2Icon className="h-3 w-3" />
      </button>
    </span>
  );
};

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

  const updateType = trpc.dms.updateDocumentType.useMutation({
    onSuccess: () => {
      void utils.dms.getDocumentTypes.invalidate();
      toast({ title: _(msg`Document type updated`) });
    },
    onError: (err) => toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
  });

  const deleteType = trpc.dms.deleteDocumentTypeById.useMutation({
    onSuccess: () => {
      void utils.dms.getDocumentTypes.invalidate();
      toast({ title: _(msg`Document type deleted`) });
    },
    onError: (err) => toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
  });

  const updateClassification = trpc.dms.updateClassification.useMutation({
    onSuccess: () => {
      void utils.dms.getClassifications.invalidate();
      toast({ title: _(msg`Classification updated`) });
    },
    onError: (err) => toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
  });

  const deleteClassification = trpc.dms.deleteClassification.useMutation({
    onSuccess: () => {
      void utils.dms.getClassifications.invalidate();
      toast({ title: _(msg`Classification deleted`) });
    },
    onError: (err) => toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
  });

  const updateTag = trpc.dms.updateTag.useMutation({
    onSuccess: () => {
      void utils.dms.getTags.invalidate();
      toast({ title: _(msg`Tag updated`) });
    },
    onError: (err) => toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
  });

  const deleteTag = trpc.dms.deleteTag.useMutation({
    onSuccess: () => {
      void utils.dms.getTags.invalidate();
      toast({ title: _(msg`Tag deleted`) });
    },
    onError: (err) => toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' }),
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
            <EditableChip
              key={type.id}
              id={type.id}
              label={type.name}
              onSave={(id, name) => updateType.mutate({ id, name })}
              onDelete={(id) => deleteType.mutate({ id })}
            />
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
            <EditableChip
              key={cls.id}
              id={cls.id}
              label={cls.name}
              onSave={(id, name) => updateClassification.mutate({ id, name })}
              onDelete={(id) => deleteClassification.mutate({ id })}
            />
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
            <EditableChip
              key={tag.id}
              id={tag.id}
              label={tag.name}
              prefix="#"
              variant="tag"
              onSave={(id, name) => updateTag.mutate({ id, name })}
              onDelete={(id) => deleteTag.mutate({ id })}
            />
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
