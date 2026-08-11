import { useEffect, useState } from 'react';

import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  BoldIcon,
  Code2Icon,
  ImageIcon,
  ItalicIcon,
  Link2Icon,
  Link2OffIcon,
  ListIcon,
  ListOrderedIcon,
  PaletteIcon,
  RedoIcon,
  TableIcon,
  UnderlineIcon,
  UndoIcon,
} from 'lucide-react';

import { cn } from '../lib/utils';

export type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  className?: string;
};

const toolbarButtonCls =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-30 aria-[pressed=true]:bg-accent aria-[pressed=true]:text-accent-foreground';

/**
 * A WYSIWYG editor that reads/writes plain HTML, for places (like workflow
 * email bodies) where end users shouldn't have to write HTML by hand.
 * `{{merge.tags}}` typed into the editor pass through as plain text, so
 * templating placeholders keep working exactly as they did in a raw HTML
 * textarea.
 *
 * Includes a "View source" mode (the `</>` button) for authors who *do* want
 * to paste raw markup — tables, images, colored text — straight in. Table,
 * image, text-color and highlight extensions are registered specifically so
 * that markup survives being reparsed when switching back to the visual
 * view; anything outside that set (arbitrary `<div>` wrappers, inline styles
 * TipTap has no node/mark for) still round-trips through source mode itself,
 * but gets normalized away the moment the visual editor re-parses it.
 */
export const RichTextEditor = ({ value, onChange, className }: RichTextEditorProps) => {
  const [mode, setMode] = useState<'visual' | 'html'>('visual');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none px-3 py-2 min-h-[96px] focus:outline-none [&_p]:my-1',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Keep the editor in sync when `value` changes from outside (e.g. the step
  // kind is switched and back, resetting the config to a snippet) — but not
  // while the source textarea owns editing, or every keystroke there would
  // bounce through a reparse.
  useEffect(() => {
    if (mode === 'html') return;
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor, mode]);

  if (!editor) {
    return null;
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL', previousUrl ?? '');

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const addImage = () => {
    const url = window.prompt('Image URL');

    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const setColor = () => {
    const previousColor = editor.getAttributes('textStyle').color as string | undefined;
    const color = window.prompt('Text color (name or hex, e.g. "crimson" or "#ff0000")', previousColor ?? '');

    if (color === null) {
      return;
    }

    if (color === '') {
      editor.chain().focus().unsetColor().run();
      return;
    }

    editor.chain().focus().setColor(color).run();
  };

  const setHighlight = () => {
    const color = window.prompt('Highlight color (name or hex, e.g. "yellow" or "#ffe066")', '#ffe066');

    if (color === null) {
      return;
    }

    if (color === '') {
      editor.chain().focus().unsetHighlight().run();
      return;
    }

    editor.chain().focus().setHighlight({ color }).run();
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input p-1">
        {mode === 'visual' && (
          <>
            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <BoldIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <ItalicIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon className="h-3.5 w-3.5" />
            </button>

            <span className="mx-0.5 h-4 w-px bg-border" />

            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrderedIcon className="h-3.5 w-3.5" />
            </button>

            <span className="mx-0.5 h-4 w-px bg-border" />

            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={!!editor.getAttributes('textStyle').color}
              onClick={setColor}
              title="Text color"
            >
              <PaletteIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('highlight')}
              onClick={setHighlight}
              title="Highlight / background color"
            >
              <span
                className="h-3.5 w-3.5 rounded-sm border border-current"
                style={{ backgroundColor: (editor.getAttributes('highlight').color as string) || 'transparent' }}
              />
            </button>

            <span className="mx-0.5 h-4 w-px bg-border" />

            <button
              type="button"
              className={toolbarButtonCls}
              aria-pressed={editor.isActive('link')}
              onClick={setLink}
              title="Link"
            >
              <Link2Icon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonCls}
              onClick={() => editor.chain().focus().unsetLink().run()}
              disabled={!editor.isActive('link')}
              title="Remove link"
            >
              <Link2OffIcon className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={toolbarButtonCls} onClick={addImage} title="Insert image">
              <ImageIcon className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={toolbarButtonCls} onClick={insertTable} title="Insert table">
              <TableIcon className="h-3.5 w-3.5" />
            </button>

            <span className="mx-0.5 h-4 w-px bg-border" />

            <button
              type="button"
              className={toolbarButtonCls}
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              title="Undo"
            >
              <UndoIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={toolbarButtonCls}
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              title="Redo"
            >
              <RedoIcon className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <button
          type="button"
          className={cn(toolbarButtonCls, 'ml-auto')}
          aria-pressed={mode === 'html'}
          onClick={() => setMode(mode === 'visual' ? 'html' : 'visual')}
          title={mode === 'visual' ? 'View HTML source' : 'Back to visual editor'}
        >
          <Code2Icon className="h-3.5 w-3.5" />
        </button>
      </div>

      {mode === 'visual' ? (
        <EditorContent editor={editor} />
      ) : (
        <textarea
          className="min-h-[96px] w-full resize-y bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
};
