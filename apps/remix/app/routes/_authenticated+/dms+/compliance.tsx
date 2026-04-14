import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { PlusIcon, ShieldCheckIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Compliance Templates');
}

const prebuiltTemplates = [
  { name: 'Tax Records', industry: 'Finance', retentionYears: 7, legalBasis: 'IRS requirements', disposalAction: 'DESTROY' },
  { name: 'Employee Records', industry: 'HR', retentionYears: 7, legalBasis: 'Employment law', disposalAction: 'DESTROY' },
  { name: 'Contracts', industry: 'Legal', retentionYears: 10, legalBasis: 'Statute of limitations', disposalAction: 'ARCHIVE' },
  { name: 'Medical Records', industry: 'Healthcare', retentionYears: 10, legalBasis: 'HIPAA', disposalAction: 'DESTROY' },
  { name: 'Financial Statements', industry: 'Finance', retentionYears: 7, legalBasis: 'SOX compliance', disposalAction: 'ARCHIVE' },
  { name: 'Insurance Policies', industry: 'Insurance', retentionYears: 6, legalBasis: 'Industry standard', disposalAction: 'ARCHIVE' },
  { name: 'Board Minutes', industry: 'Corporate', retentionYears: 0, legalBasis: 'Permanent record', disposalAction: 'ARCHIVE' },
  { name: 'Invoices & Receipts', industry: 'Finance', retentionYears: 5, legalBasis: 'Tax requirements', disposalAction: 'DESTROY' },
  { name: 'Client Correspondence', industry: 'General', retentionYears: 3, legalBasis: 'Business practice', disposalAction: 'DESTROY' },
  { name: 'GDPR Subject Data', industry: 'Privacy', retentionYears: 3, legalBasis: 'GDPR Article 17', disposalAction: 'DESTROY' },
];

export default function DmsCompliancePage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIndustry, setNewIndustry] = useState('');
  const [newYears, setNewYears] = useState(5);
  const [newBasis, setNewBasis] = useState('');

  const { data: templates, isLoading } = trpc.dms.getComplianceTemplates.useQuery();

  const createTemplate = trpc.dms.createComplianceTemplate.useMutation({
    onSuccess: () => {
      void utils.dms.getComplianceTemplates.invalidate();
      setShowAdd(false);
      setNewName('');
      setNewIndustry('');
      setNewYears(5);
      setNewBasis('');
      toast({ title: _(msg`Template created`) });
    },
  });

  const addPrebuilt = async (template: (typeof prebuiltTemplates)[0]) => {
    await createTemplate.mutateAsync(template);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold"><Trans>Compliance Templates</Trans></h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>Pre-configured retention schedules for different document types and industries.</Trans>
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
          <PlusIcon className="h-3.5 w-3.5" />
          <Trans>Create Template</Trans>
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <h3 className="text-[14px] font-semibold mb-3">New Compliance Template</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Name</label>
              <Input className="mt-1 h-8 text-[13px]" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Industry</label>
              <Input className="mt-1 h-8 text-[13px]" value={newIndustry} onChange={(e) => setNewIndustry(e.target.value)} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Retention (years)</label>
              <Input className="mt-1 h-8 text-[13px]" type="number" value={newYears} onChange={(e) => setNewYears(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Legal Basis</label>
              <Input className="mt-1 h-8 text-[13px]" value={newBasis} onChange={(e) => setNewBasis(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void createTemplate.mutateAsync({ name: newName, industry: newIndustry, retentionYears: newYears, legalBasis: newBasis })} disabled={!newName || !newIndustry}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Existing templates */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold">Your Templates</h3>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">Loading...</div>
        ) : templates && templates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Industry</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Retention</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Disposal</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Legal Basis</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-[13px] font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.industry}</td>
                    <td className="px-4 py-3 text-[12px]">{t.retentionYears === 0 ? 'Permanent' : `${t.retentionYears} years`}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.disposalAction}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.legalBasis || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-[13px] text-muted-foreground">No templates configured yet</div>
        )}
      </div>

      {/* Pre-built templates */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold">Industry Standard Templates</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Click to add these pre-configured compliance templates to your system.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
          {prebuiltTemplates.map((t, i) => (
            <button
              key={i}
              className="flex items-center gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/30"
              onClick={() => void addPrebuilt(t)}
            >
              <ShieldCheckIcon className="h-5 w-5 flex-shrink-0 text-primary" />
              <div>
                <p className="text-[13px] font-medium">{t.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t.industry} · {t.retentionYears === 0 ? 'Permanent' : `${t.retentionYears} years`} · {t.legalBasis}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
