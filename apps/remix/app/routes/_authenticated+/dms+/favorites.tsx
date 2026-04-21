import { Trans } from '@lingui/react/macro';
import { FileTextIcon, HeartIcon, StarIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('DMS Favorites');
}

export default function DmsFavoritesPage() {
  const { data: favorites, isLoading } = trpc.dms.getFavorites.useQuery();
  const utils = trpc.useUtils();

  const toggleFav = trpc.dms.toggleFavorite.useMutation({
    onSuccess: () => void utils.dms.getFavorites.invalidate(),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold"><Trans>Favorites</Trans></h2>

      <div className="rounded-[var(--r)] border border-border bg-card">
        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">Loading...</div>
        ) : favorites && favorites.length > 0 ? (
          <div className="divide-y divide-border">
            {favorites.map((fav) => (
              <div key={fav.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileTextIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/dms/doc/${fav.document.id}`} className="text-[13px] font-medium hover:underline">
                    {fav.document.title}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    {fav.document.documentType?.name || 'Uncategorized'} · {fav.document.referenceNumber}
                  </p>
                </div>
                <button
                  className="text-red-400 hover:text-red-600"
                  onClick={() => void toggleFav.mutateAsync({ documentId: fav.document.id })}
                >
                  <HeartIcon className="h-4 w-4 fill-current" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <StarIcon className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-[13px]"><Trans>No favorites yet. Star documents from their detail page.</Trans></p>
          </div>
        )}
      </div>
    </div>
  );
}
