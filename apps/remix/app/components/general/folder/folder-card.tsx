import { FolderIcon, PinIcon } from 'lucide-react';

import { FolderType } from '@documenso/lib/types/folder-type';
import { formatFolderCount } from '@documenso/lib/utils/format-folder-count';
import { type TFolderWithSubfolders } from '@documenso/trpc/server/folder-router/schema';
import { Button } from '@documenso/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';

export type FolderCardProps = {
  folder: TFolderWithSubfolders;
  onNavigate: (folderId: string) => void;
  onMove: (folder: TFolderWithSubfolders) => void;
  onPin: (folderId: string) => void;
  onUnpin: (folderId: string) => void;
  onSettings: (folder: TFolderWithSubfolders) => void;
  onDelete: (folder: TFolderWithSubfolders) => void;
};

export const FolderCard = ({
  folder,
  onNavigate,
  onMove,
  onPin,
  onUnpin,
  onSettings,
  onDelete,
}: FolderCardProps) => {
  const docCount =
    folder.type === FolderType.TEMPLATE ? folder._count.templates : folder._count.documents;
  const docLabel = folder.type === FolderType.TEMPLATE ? 'templates' : 'docs';

  return (
    <div
      key={folder.id}
      className="group flex min-w-[168px] cursor-pointer items-center gap-2.5 rounded-[var(--r)] border border-border bg-card p-3 transition-colors hover:border-primary/30"
    >
      <button
        className="flex flex-1 items-center gap-2.5 text-left"
        onClick={() => onNavigate(folder.id)}
      >
        <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FolderIcon className="h-[18px] w-[18px] text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-foreground">{folder.name}</span>
            {folder.pinned && <PinIcon className="h-3 w-3 text-primary" />}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {docCount} {docLabel}
          </div>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-[22px] w-[22px] p-0 text-[13px] text-muted-foreground opacity-0 group-hover:opacity-100"
          >
            ···
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onMove(folder)}>Move</DropdownMenuItem>
          {folder.pinned ? (
            <DropdownMenuItem onClick={() => onUnpin(folder.id)}>Unpin</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onPin(folder.id)}>Pin</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onSettings(folder)}>Settings</DropdownMenuItem>
          <DropdownMenuItem className="text-red-500" onClick={() => onDelete(folder)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
