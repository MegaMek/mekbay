// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PrintAllOptions } from '../models/print-options.model';
import type { DataService } from '../services/data.service';
import type { UnitInitializerService } from '../services/unit-initializer.service';
import type { Injector } from '@angular/core';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { getSelectedInventoryControlMode, INVENTORY_CONTROL_MODE_STATE, syncSvgMode } from './inventory-control.util';
import { nextAnimationFrames, printInOverlay } from './print-overlay.util';

export interface CBTPrintServices {
    dataService: DataService;
    unitInitializer: UnitInitializerService;
    injector: Injector;
}

type CBTSheetPrintOptions = Pick<
    PrintAllOptions,
    'clean' | 'printPilotData' | 'recordSheetCenterPanelContent' | 'printMargin'
>;

export class CBTPrintUtil {

    public static async multipagePrint(
        printServices: CBTPrintServices,
        forceUnits: CBTForceUnit[],
        printOptions: CBTSheetPrintOptions,
        triggerPrint: boolean = true
    ): Promise<void> {
        if (forceUnits.length === 0) {
            console.warn('No units to export.');
            return;
        }
        // Gather all SVGs as strings
        const svgStrings: string[] = [];
        for (const unit of forceUnits) {
            const printUnit = await this.createPrintUnit(unit, printServices, printOptions.clean);
            let svg: SVGSVGElement | null;
            let baseBv: number;
            try {
                svg = printUnit.svg()?.cloneNode(true) as SVGSVGElement | null;
                baseBv = printUnit.getBaseBv();
            } finally {
                printUnit.destroy();
            }

            if (!svg) continue;

            this.applyPilotDataPrintOption(svg, printOptions.printPilotData, baseBv);

            // Turn on/off fluff image
            const injectedEl = svg.getElementById('fluff-image-fo') as HTMLElement | null;
            if (injectedEl) {
                const centerContent = printOptions.recordSheetCenterPanelContent;
                const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
                if (centerContent === 'fluffImage') {
                    injectedEl.style.setProperty('display', 'block');
                    referenceTables.forEach((rt) => {
                        rt.style.display = 'none';
                    });
                } else {
                    injectedEl.style.setProperty('display', 'none');
                    referenceTables.forEach((rt) => {
                        rt.style.display = 'block';
                    });
                }
            }

            // Ensure font-size has units
            svg.querySelectorAll('[style]').forEach(el => {
                const style = el.getAttribute('style');
                if (!style) return;

                const fixed = this.normalizeFontSizeUnits(style);
                if (fixed !== style) {
                    el.setAttribute('style', fixed);
                }
            });

            // Inline external images so they are guaranteed to render
            await this.embedExternalImages(svg);

            // Serialize and supply any required outer SVG attributes.
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svg);
            svgString = svgString.replace(
                /^<svg([^>]*)>/,
                (_match, attrs) => {
                    let svgAttributes = attrs;
                    if (!/viewBox=/.test(svgAttributes)) {
                        svgAttributes += ' viewBox="0 0 612 792"';
                    }
                    if (!/xmlns=/.test(svgAttributes)) {
                        svgAttributes += ' xmlns="http://www.w3.org/2000/svg"';
                    }
                    if (!/xmlns:xlink=/.test(svgAttributes)) {
                        svgAttributes += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
                    }
                    if (!/preserveAspectRatio=/.test(svgAttributes)) {
                        svgAttributes += ' preserveAspectRatio="xMidYMid meet"';
                    }
                    return `<svg${svgAttributes}>`;
                }
            );
            svgStrings.push(svgString);
        }
        await this.generateMultipagePrintContainer(svgStrings, printOptions.printMargin, triggerPrint);
    }

    private static normalizeFontSizeUnits(style: string): string {
        return style.replace(
            /font-size\s*:\s*(\d+(?:\.\d+)?)(\s*)(?=;|$)/gi,
            (_match, number, spacing) => `font-size: ${number}px${spacing}`,
        );
    }

    private static async createPrintUnit(
        unit: CBTForceUnit,
        printServices: CBTPrintServices,
        clean: boolean
    ): Promise<CBTForceUnit> {
        const serializedUnit = unit.serialize();
        const printUnit = CBTForceUnit.deserialize(
            serializedUnit,
            unit.force,
            printServices.dataService,
            printServices.unitInitializer,
            printServices.injector
        );
        printUnit.disabledSaving = true;

        try {
            await printUnit.load();
            printUnit.update(serializedUnit);

            if (clean) {
                printUnit.repairAll();
            } else {
                const heat = printUnit.getHeat();
                if (heat.heatsinksOff !== undefined) {
                    printUnit.setHeatsinksOff(0);
                }
                printUnit.setHeatData({ current: 0, previous: 0, next: undefined });
            }

            this.resetInventoryControlModes(printUnit);
            printUnit.clearInventoryControlSelection();
            printUnit.turnState().update(undefined);
            printUnit.syncInventoryControlSelectionSvg();
            printUnit.svgService?.forceRepaint();
            await nextAnimationFrames(2);

            return printUnit;
        } catch (error) {
            printUnit.destroy();
            throw error;
        }
    }

    private static resetInventoryControlModes(printUnit: CBTForceUnit): void {
        for (const entry of printUnit.getInventory()) {
            if (entry.deleteState(INVENTORY_CONTROL_MODE_STATE)) {
                printUnit.setInventoryEntry(entry);
            }
            const defaultMode = getSelectedInventoryControlMode(
                entry,
                EMPTY_EQUIPMENT_REGISTRY,
                printUnit.getInventoryControlRules().matchesAmmo
            );
            syncSvgMode(entry, defaultMode, false);
        }
    }

    /**
     * Fetches external <image> hrefs and embeds them as data URLs.
     */
    private static async embedExternalImages(svg: SVGSVGElement): Promise<void> {
        const images = Array.from(svg.querySelectorAll('image')) as SVGImageElement[];
        const toDataURL = async (blob: Blob) =>
            new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result));
                fr.onerror = reject;
                fr.readAsDataURL(blob);
            });

        await Promise.all(images.map(async (img) => {
            const href = this.getImageHref(img);
            if (!href || href.startsWith('data:')) return;

            // Resolve relative URLs against document
            let url: string;
            try {
                url = new URL(href, document.baseURI).toString();
            } catch {
                return; // ignore bad URLs
            }

            try {
                const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
                if (!resp.ok) return;
                const blob = await resp.blob();
                const dataUrl = await toDataURL(blob);
                this.setImageHref(img, dataUrl);
            } catch {
                // If CORS blocks fetch, ignore
            }
        }));
    }

    private static getImageHref(img: SVGImageElement): string | null {
        return img.getAttribute('href') ??
            img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    }

    private static setImageHref(img: SVGImageElement, value: string): void {
        img.setAttribute('href', value);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', value);
    }

    private static applyPilotDataPrintOption(
        svg: SVGSVGElement,
        printPilotData: boolean,
        baseBv?: number
    ): void {
        svg.querySelectorAll('.skillValue').forEach((skillValue) => {
            skillValue.classList.toggle('screen-only', !printPilotData);
        });

        const skillBlanks = [
            'blankPilotingSkill0',
            'blankGunnerySkill0',
            'blankAsfGunnerySkill0',
            'blankAsfPilotingSkill0',
            'blankPilotingSkill1',
            'blankGunnerySkill1',
            'blankPilotingSkill2',
            'blankGunnerySkill2',
            'blankPilotingSkill3',
            'blankGunnerySkill3'
        ];
        skillBlanks.forEach((id) => {
            svg.getElementById(id)?.classList.toggle('print-show', !printPilotData);
        });

        if (printPilotData) return;

        const bvElement = svg.getElementById('bv');
        if (bvElement && baseBv !== undefined) {
            bvElement.textContent = baseBv.toString();
        }

        svg.querySelectorAll<SVGElement>('[id^="crewNameButton"]').forEach((crewNameButton) => {
            const nameId = crewNameButton.getAttribute('textElement');
            const blankId = crewNameButton.getAttribute('blankElement');
            if (nameId) {
                const nameElement = svg.getElementById(nameId) as SVGElement | null;
                nameElement?.style.setProperty('visibility', 'hidden');
            }
            if (blankId) {
                const blankElement = svg.getElementById(blankId) as SVGElement | null;
                blankElement?.style.setProperty('visibility', 'visible');
            }
        });
    }

    /**
     * Generates a multipage print container and waits for images to load before printing.
     */
    private static async generateMultipagePrintContainer(
        svgStrings: string[],
        printMargin: PrintAllOptions['printMargin'],
        triggerPrint: boolean,
    ): Promise<void> {
        const pages = svgStrings.map(svg => `<div class="svg-container">${svg}</div>`);
        if (pages.length === 0) return;

        pages[pages.length - 1] = pages[pages.length - 1].replace('svg-container', 'svg-container last-svg');

        await printInOverlay({
            containerId: 'multipage-container',
            bodyClass: 'multipage-container-active',
            content: pages.join(''),
            styles: this.getPrintStyles(printMargin),
            triggerPrint,
            onImageError: image => this.fallbackFluffImageToReferenceTables(image),
        });
    }

    private static fallbackFluffImageToReferenceTables(image: Element): void {
        if (image.id !== 'fluff-image-injected') {
            return;
        }

        const svg = image.closest('svg') as SVGSVGElement | null;
        if (!svg) {
            return;
        }

        const injectedEl = svg.getElementById('fluff-image-fo') as SVGElement | null;
        (injectedEl ?? image as SVGElement).style.setProperty('display', 'none');
        svg.querySelectorAll<SVGGraphicsElement>('.referenceTable').forEach((referenceTable) => {
            referenceTable.style.display = 'block';
        });
    }

    private static getPrintStyles(printMargin: PrintAllOptions['printMargin']): string {
        return `
            @media screen {
                #multipage-container {
                    display: none;
                }
            }

            @media print {
                body, html {
                    margin: 0 !important;
                    padding: 0 !important;
                    height: 100% !important;
                    width: 100% !important;
                }

                body.multipage-container-active > *:not(#multipage-container) {
                    display: none !important;
                }

                #multipage-container {
                    width: 100% !important;
                    height: 100% !important;
                    padding: 0;
                    margin: 0;
                    left: 0;
                    top: 0;
                    display: block;
                    background: transparent !important;
                }
                #multipage-container .svg-container {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    background: white !important;
                    width: 100% !important;
                    height: 100% !important;
                    margin: 0 auto !important;
                    box-sizing: border-box;
                    page-break-after: always;
                    break-after: page;
                    overflow: hidden;
                }
                #multipage-container .svg-container.last-svg { 
                    page-break-after: auto !important;
                    break-after: auto !important;
                }

                #multipage-container .svg-container > svg {
                    display: block;
                    box-sizing: border-box;
                    padding: 0;
                    margin: 0in 0.16in;
                    transform: none !important;
                    height: 100%;
                    width: auto;
                    max-width: 100%;
                    min-width: 0;
                    max-height: 100%;
                    page-break-inside: avoid;
                    break-inside: avoid;
                }

                @page {
                    size: auto;                    
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

}
