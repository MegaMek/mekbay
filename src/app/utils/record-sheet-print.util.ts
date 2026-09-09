// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PrintAllOptions } from '../models/print-options.model';
import { printInOverlay } from './print-overlay.util';
import { fallbackRecordSheetFluffImage } from './record-sheet-center-panel.util';

/**
 * Prints already-rendered full pages, including a design's supplemental sheets.
 * @page sets the document size; the browser still controls the printer's paper size.
 * Zero page margins suppress automatic browser headers/footers in the default mode.
 */
export async function printRecordSheetPages(
    sheets: readonly SVGSVGElement[],
    options: Pick<PrintAllOptions, 'paperSize' | 'printMargin'>,
    triggerPrint = true,
): Promise<void> {
    if (sheets.length === 0) throw new Error('No record sheet pages are available to print.');
    const serializer = new XMLSerializer();
    const content = sheets.map(sheet => {
        const page = sheet.cloneNode(true) as SVGSVGElement;
        page.style.removeProperty('width');
        page.style.removeProperty('height');
        page.style.removeProperty('transform');
        return `<div class="record-sheet-print-page">${serializer.serializeToString(page)}</div>`;
    }).join('');

    await printInOverlay({
        containerId: 'record-sheet-print-container',
        bodyClass: 'record-sheet-print-active',
        content,
        triggerPrint,
        onImageError: fallbackRecordSheetFluffImage,
        styles: `
            @media screen { #record-sheet-print-container { display: none; } }
            @media print {
                html, body { margin: 0 !important; padding: 0 !important; height: 100%; }
                body.record-sheet-print-active > :not(#record-sheet-print-container) { display: none !important; }
                #record-sheet-print-container { display: block; width: 100%; height: 100%; }
                #record-sheet-print-container .record-sheet-print-page {
                    display: flex; align-items: center; justify-content: center;
                    width: 100%; height: 100%; overflow: hidden;
                    break-after: page; break-inside: avoid; background: white;
                }
                #record-sheet-print-container .record-sheet-print-page:last-child { break-after: auto; }
                #record-sheet-print-container .record-sheet-print-page > svg {
                    display: block; width: 100%; height: 100%; max-width: 100%; max-height: 100%;
                    margin: 0; padding: 0; transform: none !important;
                }
                @page {
                    size: ${options.paperSize === 'a4' ? 'A4' : 'Letter'} portrait;
                    margin: ${options.printMargin === 'none' ? '0' : '0.25in'} !important;
                }
            }
        `,
    });
}
