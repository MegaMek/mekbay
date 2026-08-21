// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CBTPrintUtil } from './cbtprint.util';
import { WeaponEquipment } from '../models/equipment.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { INVENTORY_CONTROL_MODE_STATE } from './inventory-control.util';
import { waitForPrintImages } from './print-overlay.util';

describe('CBTPrintUtil', () => {
    it('keeps the injected HTML fluff image visible when it loads successfully', async () => {
        const svg = createSheetSvg();
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('id', 'fluff-image-fo');
        foreignObject.style.display = 'block';

        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img') as HTMLImageElement;
        image.setAttribute('id', 'fluff-image-injected');
        image.setAttribute('src', 'https://example.invalid/fluff.png');
        foreignObject.appendChild(image);
        svg.appendChild(foreignObject);

        const wait = waitForSvgImagesToLoad(svg);
        image.dispatchEvent(new Event('load'));

        await wait;

        expect(foreignObject.style.display).toBe('block');
        expect(getReferenceTable(svg).style.display).toBe('none');
    });

    it('restores reference tables when the injected HTML fluff image fails to load', async () => {
        const svg = createSheetSvg();
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('id', 'fluff-image-fo');
        foreignObject.style.display = 'block';

        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img') as HTMLImageElement;
        image.setAttribute('id', 'fluff-image-injected');
        image.setAttribute('src', 'https://example.invalid/fluff.png');
        foreignObject.appendChild(image);
        svg.appendChild(foreignObject);

        const wait = waitForSvgImagesToLoad(svg);
        image.dispatchEvent(new Event('error'));

        await wait;

        expect(foreignObject.style.display).toBe('none');
        expect(getReferenceTable(svg).style.display).toBe('block');
    });

    it('restores reference tables when an injected SVG fluff image fails to load', async () => {
        const svg = createSheetSvg();
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('id', 'fluff-image-injected');
        image.setAttribute('href', 'https://example.invalid/fluff.png');
        image.style.display = 'block';
        svg.appendChild(image);

        const wait = waitForSvgImagesToLoad(svg);
        image.dispatchEvent(new Event('error'));

        await wait;

        expect(image.style.display).toBe('none');
        expect(getReferenceTable(svg).style.display).toBe('block');
    });

    it('resets persisted inventory modes to sheet defaults before printing', () => {
        const entryEl = createInventoryEntryWithModes();
        const entry = {
            id: 'weapon',
            states: new Map([[INVENTORY_CONTROL_MODE_STATE, 'Pulse']]),
            el: entryEl,
            owner: { getUnit: () => createEmptyUnit() },
            equipment: new WeaponEquipment({
                id: 'ATM6',
                name: 'ATM 6',
                type: 'weapon',
                weapon: { ammoType: 'ATM', rackSize: 6 }
            }),
            isPhysicalWeapon: () => false,
            deleteState(name: string): boolean {
                if (!this.states.has(name)) return false;
                this.states = new Map(this.states);
                this.states.delete(name);
                return true;
            }
        };
        const printUnit = {
            getInventory: () => [entry],
            getInventoryControlRules: () => ({}),
            setInventoryEntry: jasmine.createSpy('setInventoryEntry')
        };

        resetInventoryControlModes(printUnit);

        expect(entry.states.has(INVENTORY_CONTROL_MODE_STATE)).toBeFalse();
        expect(printUnit.setInventoryEntry).toHaveBeenCalledWith(entry);
        expect(entryEl.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('Standard');
    });

    it('prints default skills and a pilot name when pilot data is enabled', () => {
        const svg = createPilotDataSvg();
        const skillValue = svg.getElementById('gunnerySkill0')!;
        const skillBlank = svg.getElementById('blankGunnerySkill0')!;
        const pilotName = svg.getElementById('pilotName0') as SVGElement;
        const nameBlank = svg.getElementById('blankCrewName0') as SVGElement;

        skillValue.classList.add('screen-only');
        skillBlank.classList.add('print-show');
        pilotName.style.visibility = 'visible';
        nameBlank.style.visibility = 'hidden';

        applyPilotDataPrintOption(svg, true);

        expect(skillValue.classList).not.toContain('screen-only');
        expect(skillBlank.classList).not.toContain('print-show');
        expect(pilotName.style.visibility).toBe('visible');
        expect(nameBlank.style.visibility).toBe('hidden');
    });

    it('hides skills and pilot names but shows writing lines when pilot data is disabled', () => {
        const svg = createPilotDataSvg();
        const skillValue = svg.getElementById('gunnerySkill0')!;
        const skillBlank = svg.getElementById('blankGunnerySkill0')!;
        const pilotName = svg.getElementById('pilotName0') as SVGElement;
        const nameBlank = svg.getElementById('blankCrewName0') as SVGElement;

        pilotName.style.visibility = 'visible';
        nameBlank.style.visibility = 'hidden';

        applyPilotDataPrintOption(svg, false, 1000);

        expect(skillValue.classList).toContain('screen-only');
        expect(skillBlank.classList).toContain('print-show');
        expect(pilotName.style.visibility).toBe('hidden');
        expect(nameBlank.style.visibility).toBe('visible');
        expect(svg.getElementById('bv')?.textContent).toBe('1000');
    });

    it('keeps the skill-adjusted sheet BV when pilot data is enabled', () => {
        const svg = createPilotDataSvg();

        applyPilotDataPrintOption(svg, true, 1000);

        expect(svg.getElementById('bv')?.textContent).toBe('1500 (1000)');
    });

    it('builds a sheets-only print container', async () => {
        await generateMultipagePrintContainer(
            ['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
            'none',
            false,
        );

        const overlay = document.getElementById('multipage-container')!;
        expect(overlay.querySelectorAll('.svg-container')).toHaveSize(1);
        expect(overlay.querySelector('.cbt-roster-summary')).toBeNull();

        window.dispatchEvent(new Event('click'));
    });

    it('adds px only to unitless SVG font sizes', () => {
        expect(normalizeFontSizeUnits('font-size: 12; font-size: 14px; font-size: 75%'))
            .toBe('font-size: 12px; font-size: 14px; font-size: 75%');
        expect(normalizeFontSizeUnits('font-size: 10.5'))
            .toBe('font-size: 10.5px');
    });
});

function createSheetSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const referenceTable = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    referenceTable.classList.add('referenceTable');
    referenceTable.style.display = 'none';
    svg.appendChild(referenceTable);
    return svg;
}

function getReferenceTable(svg: SVGSVGElement): SVGGraphicsElement {
    return svg.querySelector('.referenceTable') as SVGGraphicsElement;
}

function createPilotDataSvg(): SVGSVGElement {
    return new DOMParser().parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <text id="gunnerySkill0" class="skillValue">4</text>
            <path id="blankGunnerySkill0" />
            <g id="crewNameButton0" textElement="pilotName0" blankElement="blankCrewName0" />
            <text id="pilotName0">Morgan</text>
            <path id="blankCrewName0" />
            <text id="bv">1500 (1000)</text>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function waitForSvgImagesToLoad(root: ParentNode): Promise<void> {
    return waitForPrintImages(root, image => fallbackFluffImageToReferenceTables(image));
}

function fallbackFluffImageToReferenceTables(image: Element): void {
    (CBTPrintUtil as unknown as {
        fallbackFluffImageToReferenceTables(image: Element): void;
    }).fallbackFluffImageToReferenceTables(image);
}

function createInventoryEntryWithModes(): SVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry">
                <g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>5</text></g></g>
                <g class="alternativeMode selected" mode="Pulse"><g class="name"><text>Pulse</text></g><g class="damage"><text>5</text></g></g>
            </g>
        </svg>
    `, 'image/svg+xml').querySelector('.inventoryEntry') as SVGElement;
}

function resetInventoryControlModes(printUnit: unknown): void {
    return (CBTPrintUtil as unknown as {
        resetInventoryControlModes(printUnit: unknown): void;
    }).resetInventoryControlModes(printUnit);
}

function applyPilotDataPrintOption(svg: SVGSVGElement, printPilotData: boolean, baseBv?: number): void {
    (CBTPrintUtil as unknown as {
        applyPilotDataPrintOption(svg: SVGSVGElement, printPilotData: boolean, baseBv?: number): void;
    }).applyPilotDataPrintOption(svg, printPilotData, baseBv);
}

function generateMultipagePrintContainer(
    svgStrings: string[],
    printMargin: 'none' | 'browserDefined',
    triggerPrint: boolean,
): Promise<void> {
    return (CBTPrintUtil as unknown as {
        generateMultipagePrintContainer(
            svgStrings: string[],
            printMargin: 'none' | 'browserDefined',
            triggerPrint: boolean,
        ): Promise<void>;
    }).generateMultipagePrintContainer(svgStrings, printMargin, triggerPrint);
}

function normalizeFontSizeUnits(style: string): string {
    return (CBTPrintUtil as unknown as {
        normalizeFontSizeUnits(style: string): string;
    }).normalizeFontSizeUnits(style);
}
