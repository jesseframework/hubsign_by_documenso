import { useState } from 'react';

import { BotIcon } from 'lucide-react';

import { Sheet, SheetContent } from '@documenso/ui/primitives/sheet';

import { AubreyChat } from './aubrey-chat';

/**
 * Global Aubrey launcher. Rendered once in the authenticated layout, so it
 * persists across navigation. The chat only mounts (and its queries only fire)
 * while the panel is open, since Radix unmounts Sheet content when closed.
 */
export function AubreyFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open Aubrey AI"
        onClick={() => setOpen(true)}
        className="bg-primary shadow-primary/40 fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6"
      >
        <BotIcon className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent position="right" size="default" className="flex flex-col gap-0 p-0">
          <div className="border-border flex items-center gap-2 border-b px-4 py-3">
            <div className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-full">
              <BotIcon className="text-primary h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Aubrey AI</p>
              <p className="text-muted-foreground text-[11px]">Scoped to what you can access</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <AubreyChat compact />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
