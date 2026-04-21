import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Recycle Bin');
}

export default function OrgRecycleBinPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: items, isLoading } = trpc.org.getRecycleBin.useQuery();

  const restore = trpc.org.restoreFromRecycleBin.useMutation({
    onSuccess: () => {
      void utils.org.getRecycleBin.invalidate();
      toast({ title: _(msg`Document restored`) });
    },
  });

  const permDelete = trpc.org.permanentlyDelete.useMutation({
    onSuccess: () => {
      void utils.org.getRecycleBin.invalidate();
      toast({ title: _(msg`Document permanently deleted`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Recycle Bin</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Deleted documents are kept for 30 days before permanent removal.</Trans>
        </p>
      </div>

      <div className="rounded-[var(--r)] border border-border bg-card">
        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">Loading...</div>
        ) : items && items.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Document</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Deleted By</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Deleted On</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Expires</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const daysLeft = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium">{item.document.title}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{item.document.referenceNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {item.deletedBy.name || item.deletedBy.email}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[12px] font-medium ${daysLeft < 7 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {daysLeft} days left
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-[11px] text-green-600"
                          onClick={() => void restore.mutateAsync({ documentId: item.document.id })}
                        >
                          <RotateCcwIcon className="h-3 w-3" />
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-[11px] text-destructive"
                          onClick={() => void permDelete.mutateAsync({ documentId: item.document.id })}
                        >
                          <Trash2Icon className="h-3 w-3" />
                          Delete Forever
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Trash2Icon className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-[13px]"><Trans>Recycle bin is empty</Trans></p>
          </div>
        )}
      </div>
    </div>
  );
}
