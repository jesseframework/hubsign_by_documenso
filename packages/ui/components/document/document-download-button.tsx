import type { HTMLAttributes } from 'react';
import { useState } from 'react';

import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import type { DocumentData } from '@prisma/client';
import { ChevronDown, Download, FileText, Printer } from 'lucide-react';

import { downloadPDF } from '@documenso/lib/client-only/download-pdf';
import { printPDF } from '@documenso/lib/client-only/print-pdf';
import { useToast } from '@documenso/ui/primitives/use-toast';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../primitives/dropdown-menu';
import { Button } from '../../primitives/button';

export type DownloadButtonProps = HTMLAttributes<HTMLButtonElement> & {
  disabled?: boolean;
  fileName?: string;
  documentData?: DocumentData;
  /**
   * Number of trailing pages that are the audit certificate. When > 0 the
   * download button becomes a split-dropdown so the user can pick whether
   * to include the certificate. Default 0 (no dropdown — single button).
   */
  certificatePageCount?: number;
  /**
   * Button style. Defaults to `outline`, which is what this component has always
   * rendered — pass `default` where download is the page's primary action and an
   * outline button would disappear into the surface it sits on.
   */
  variant?: 'outline' | 'default' | 'secondary';
};

export const DocumentDownloadButton = ({
  className,
  fileName,
  documentData,
  disabled,
  certificatePageCount = 0,
  variant = 'outline',
  ...props
}: DownloadButtonProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);

  const runDownload = async (stripTrailingPages: number) => {
    if (!documentData) return;
    try {
      setIsLoading(true);
      await downloadPDF({ documentData, fileName, stripTrailingPages });
    } catch (err) {
      toast({
        title: _('Something went wrong'),
        description: _('An error occurred while downloading your document.'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runPrint = async (stripTrailingPages: number) => {
    if (!documentData) return;
    try {
      await printPDF({ documentData, stripTrailingPages });
    } catch (err) {
      toast({
        title: _('Something went wrong'),
        description: _('An error occurred while preparing the print preview.'),
        variant: 'destructive',
      });
    }
  };

  const hasCertificate = certificatePageCount > 0;

  // No certificate to opt out of → keep the original single-button behavior.
  if (!hasCertificate) {
    return (
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={disabled || !documentData}
        onClick={() => void runDownload(0)}
        loading={isLoading}
        {...props}
      >
        {!isLoading && <Download className="mr-2 h-5 w-5" />}
        <Trans>Download</Trans>
      </Button>
    );
  }

  // Has a certificate → split-dropdown: primary button downloads with cert
  // (matches the historical default), the chevron opens the option to
  // download a copy without the audit pages stripped off.
  return (
    <div className={`inline-flex ${className ?? ''}`}>
      <Button
        type="button"
        variant={variant}
        className="rounded-r-none"
        disabled={disabled || !documentData}
        onClick={() => void runDownload(0)}
        loading={isLoading}
      >
        {!isLoading && <Download className="mr-2 h-5 w-5" />}
        <Trans>Download</Trans>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={variant}
            className="border-l-0 rounded-l-none px-2"
            disabled={disabled || !documentData}
            aria-label="Download options"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={() => void runDownload(0)}>
            <Download className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span className="text-sm">
                <Trans>Download with audit certificate</Trans>
              </span>
              <span className="text-muted-foreground text-xs">
                <Trans>Includes the Final Audit Report page</Trans>
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void runDownload(certificatePageCount)}>
            <FileText className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span className="text-sm">
                <Trans>Download without audit certificate</Trans>
              </span>
              <span className="text-muted-foreground text-xs">
                <Trans>Just the signed document pages</Trans>
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void runPrint(0)}>
            <Printer className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span className="text-sm">
                <Trans>Print with audit certificate</Trans>
              </span>
              <span className="text-muted-foreground text-xs">
                <Trans>Opens print dialog including the cert</Trans>
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void runPrint(certificatePageCount)}>
            <Printer className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span className="text-sm">
                <Trans>Print without audit certificate</Trans>
              </span>
              <span className="text-muted-foreground text-xs">
                <Trans>Opens print dialog, signed pages only</Trans>
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
