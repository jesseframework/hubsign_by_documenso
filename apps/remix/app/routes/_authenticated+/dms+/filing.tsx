import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ArchiveIcon,
  BoxIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderOpenIcon,
  MapPinIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Filing Structure');
}

export default function DmsFilingPage() {
  const { _ } = useLingui();
  const { toast } = useToast();

  const [newLocationName, setNewLocationName] = useState('');
  const [newCabinetName, setNewCabinetName] = useState('');
  const [newShelfName, setNewShelfName] = useState('');
  const [newBinName, setNewBinName] = useState('');

  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [expandedCabinet, setExpandedCabinet] = useState<string | null>(null);
  const [expandedShelf, setExpandedShelf] = useState<string | null>(null);

  const [addingTo, setAddingTo] = useState<{
    type: 'location' | 'cabinet' | 'shelf' | 'bin';
    parentId?: string;
  } | null>(null);

  const utils = trpc.useUtils();
  const { data: locations, isLoading } = trpc.dms.getLocations.useQuery();

  const createLocation = trpc.dms.createLocation.useMutation({
    onSuccess: () => {
      void utils.dms.getLocations.invalidate();
      setNewLocationName('');
      setAddingTo(null);
      toast({ title: _(msg`Location created`) });
    },
  });

  const createCabinet = trpc.dms.createCabinet.useMutation({
    onSuccess: () => {
      void utils.dms.getLocations.invalidate();
      setNewCabinetName('');
      setAddingTo(null);
      toast({ title: _(msg`Cabinet created`) });
    },
  });

  const createShelf = trpc.dms.createShelf.useMutation({
    onSuccess: () => {
      void utils.dms.getLocations.invalidate();
      setNewShelfName('');
      setAddingTo(null);
      toast({ title: _(msg`Shelf created`) });
    },
  });

  const createBin = trpc.dms.createBin.useMutation({
    onSuccess: () => {
      void utils.dms.getLocations.invalidate();
      setNewBinName('');
      setAddingTo(null);
      toast({ title: _(msg`Bin created`) });
    },
  });

  const deleteLocation = trpc.dms.deleteLocation.useMutation({
    onSuccess: () => {
      void utils.dms.getLocations.invalidate();
      toast({ title: _(msg`Location deleted`) });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          <Trans>Filing Structure</Trans>
        </h2>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setAddingTo({ type: 'location' })}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          <Trans>Add Location</Trans>
        </Button>
      </div>

      {/* Add location form */}
      {addingTo?.type === 'location' && (
        <div className="flex gap-2 rounded-[var(--r)] border border-border bg-card p-3">
          <Input
            className="h-8 text-[13px]"
            placeholder="Location name (e.g. Head Office)"
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            autoFocus
          />
          <Button
            size="sm"
            onClick={() => createLocation.mutate({ name: newLocationName })}
            disabled={!newLocationName.trim()}
          >
            <Trans>Create</Trans>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAddingTo(null)}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      )}

      {/* Tree view */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            <Trans>Loading...</Trans>
          </div>
        ) : locations && locations.length > 0 ? (
          <div className="divide-y divide-border">
            {locations.map((location) => (
              <div key={location.id}>
                {/* Location */}
                <div
                  className="flex cursor-pointer items-center gap-2.5 px-4 py-3 transition-colors hover:bg-muted/30"
                  onClick={() =>
                    setExpandedLocation(expandedLocation === location.id ? null : location.id)
                  }
                >
                  <ChevronRightIcon
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                      expandedLocation === location.id ? 'rotate-90' : ''
                    }`}
                  />
                  <MapPinIcon className="h-4 w-4 text-primary" />
                  <span className="flex-1 text-[13px] font-medium">{location.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {location.cabinets.length} cabinets
                  </span>
                  <button
                    className="ml-2 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLocation.mutate({ id: location.id });
                    }}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Cabinets */}
                {expandedLocation === location.id && (
                  <div className="border-t border-border bg-muted/20">
                    {location.cabinets.map((cabinet) => (
                      <div key={cabinet.id}>
                        <div
                          className="flex cursor-pointer items-center gap-2.5 py-2.5 pl-10 pr-4 transition-colors hover:bg-muted/30"
                          onClick={() =>
                            setExpandedCabinet(expandedCabinet === cabinet.id ? null : cabinet.id)
                          }
                        >
                          <ChevronRightIcon
                            className={`h-3 w-3 text-muted-foreground transition-transform ${
                              expandedCabinet === cabinet.id ? 'rotate-90' : ''
                            }`}
                          />
                          <ServerIcon className="h-3.5 w-3.5 text-amber-600" />
                          <span className="flex-1 text-[12px] font-medium">{cabinet.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {cabinet.shelves.length} shelves
                          </span>
                        </div>

                        {/* Shelves */}
                        {expandedCabinet === cabinet.id && (
                          <div className="bg-muted/10">
                            {cabinet.shelves.map((shelf) => (
                              <div key={shelf.id}>
                                <div
                                  className="flex cursor-pointer items-center gap-2.5 py-2 pl-16 pr-4 transition-colors hover:bg-muted/30"
                                  onClick={() =>
                                    setExpandedShelf(
                                      expandedShelf === shelf.id ? null : shelf.id,
                                    )
                                  }
                                >
                                  <ChevronRightIcon
                                    className={`h-3 w-3 text-muted-foreground transition-transform ${
                                      expandedShelf === shelf.id ? 'rotate-90' : ''
                                    }`}
                                  />
                                  <FolderOpenIcon className="h-3.5 w-3.5 text-blue-500" />
                                  <span className="flex-1 text-[12px]">{shelf.name}</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {shelf.bins.length} bins
                                  </span>
                                </div>

                                {/* Bins */}
                                {expandedShelf === shelf.id && (
                                  <div>
                                    {shelf.bins.map((bin) => (
                                      <div
                                        key={bin.id}
                                        className="group/bin flex items-center gap-2.5 py-2 pl-24 pr-4 transition-colors hover:bg-muted/30"
                                      >
                                        <BoxIcon className="h-3.5 w-3.5 text-green-600" />
                                        <span className="flex-1 text-[12px]">{bin.name}</span>
                                        {bin.barcode && (
                                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                                            {bin.barcode}
                                          </span>
                                        )}
                                        <Link
                                          to={`/dms/documents?binId=${bin.id}`}
                                          className="text-[10px] text-primary hover:underline"
                                        >
                                          {bin._count.documents} docs
                                        </Link>
                                        <Link
                                          to={`/dms/documents?prefillBin=${bin.id}`}
                                          className="hidden items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15 group-hover/bin:flex"
                                        >
                                          <UploadIcon className="h-2.5 w-2.5" />
                                          Add Doc
                                        </Link>
                                      </div>
                                    ))}

                                    {/* Add bin */}
                                    {addingTo?.type === 'bin' &&
                                    addingTo.parentId === shelf.id ? (
                                      <div className="flex gap-2 py-2 pl-24 pr-4">
                                        <Input
                                          className="h-7 text-[11px]"
                                          placeholder="Bin name"
                                          value={newBinName}
                                          onChange={(e) => setNewBinName(e.target.value)}
                                          autoFocus
                                        />
                                        <Button
                                          size="sm"
                                          className="h-7 text-[11px]"
                                          onClick={() =>
                                            createBin.mutate({
                                              name: newBinName,
                                              shelfId: shelf.id,
                                            })
                                          }
                                        >
                                          Add
                                        </Button>
                                      </div>
                                    ) : (
                                      <button
                                        className="flex w-full items-center gap-2 py-2 pl-24 pr-4 text-[11px] text-muted-foreground hover:text-foreground"
                                        onClick={() =>
                                          setAddingTo({ type: 'bin', parentId: shelf.id })
                                        }
                                      >
                                        <PlusIcon className="h-3 w-3" />
                                        Add Bin
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}

                            {/* Add shelf */}
                            {addingTo?.type === 'shelf' &&
                            addingTo.parentId === cabinet.id ? (
                              <div className="flex gap-2 py-2 pl-16 pr-4">
                                <Input
                                  className="h-7 text-[11px]"
                                  placeholder="Shelf name"
                                  value={newShelfName}
                                  onChange={(e) => setNewShelfName(e.target.value)}
                                  autoFocus
                                />
                                <Button
                                  size="sm"
                                  className="h-7 text-[11px]"
                                  onClick={() =>
                                    createShelf.mutate({
                                      name: newShelfName,
                                      cabinetId: cabinet.id,
                                    })
                                  }
                                >
                                  Add
                                </Button>
                              </div>
                            ) : (
                              <button
                                className="flex w-full items-center gap-2 py-2 pl-16 pr-4 text-[11px] text-muted-foreground hover:text-foreground"
                                onClick={() =>
                                  setAddingTo({ type: 'shelf', parentId: cabinet.id })
                                }
                              >
                                <PlusIcon className="h-3 w-3" />
                                Add Shelf
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add cabinet */}
                    {addingTo?.type === 'cabinet' && addingTo.parentId === location.id ? (
                      <div className="flex gap-2 py-2.5 pl-10 pr-4">
                        <Input
                          className="h-7 text-[11px]"
                          placeholder="Cabinet name"
                          value={newCabinetName}
                          onChange={(e) => setNewCabinetName(e.target.value)}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() =>
                            createCabinet.mutate({
                              name: newCabinetName,
                              locationId: location.id,
                            })
                          }
                        >
                          Add
                        </Button>
                      </div>
                    ) : (
                      <button
                        className="flex w-full items-center gap-2 py-2.5 pl-10 pr-4 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setAddingTo({ type: 'cabinet', parentId: location.id })
                        }
                      >
                        <PlusIcon className="h-3 w-3" />
                        Add Cabinet
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ArchiveIcon className="mb-3 h-12 w-12 opacity-30" />
            <p className="text-[13px] font-medium">
              <Trans>No filing locations yet</Trans>
            </p>
            <p className="mt-1 text-[11px]">
              <Trans>Create your first location to start organizing documents.</Trans>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
