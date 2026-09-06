// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createInfantryStrengthDisplay,INFANTRY_STRENGTH_DISPLAY_ID } from './infantry-strength-display';
import { svgElement } from './record-sheet-svg-rendering';

describe('generated infantry strength display', () => {
    it('renders every artwork state from typed counts, ignoring mutated DOM classes and hrefs', () => {
        jasmine.clock().install();
        try {
            const svg = svgElement('svg');
            const host = svgElement('g');
            svg.appendChild(host);
            const display = createInfantryStrengthDisplay(svg, host);
            display.render(undefined, { maximum: 4, committedRemaining: 3, previewRemaining: 3 }, false);
            const cell = display.cells[27]!.element;
            expect(cell.querySelector('use')?.getAttribute('href')).toBe('#mekbay-infantry-trooper-art');
            cell.classList.add('damaged', 'fresh');
            cell.querySelector('use')!.setAttribute('href', '#wrong-art');
            display.render(undefined, { maximum: 4, committedRemaining: 3, previewRemaining: 3 }, true);
            expect(cell.querySelector('use')?.getAttribute('href')).toBe('#mekbay-infantry-trooper-art');
            display.render(undefined, { maximum: 4, committedRemaining: 3, previewRemaining: 2 }, true);
            expect(cell.querySelector('use')?.getAttribute('href')).toBe('#mekbay-infantry-fresh-art');
            jasmine.clock().tick(5000);
            expect(cell.querySelector('use')?.getAttribute('href')).toBe('#mekbay-infantry-fresh-art');
            display.render(undefined, { maximum: 4, committedRemaining: 2, previewRemaining: 2 }, true);
            expect(cell.querySelector('use')?.getAttribute('href')).toBe('#mekbay-infantry-committed-art');
            display.render(undefined, { maximum: 4, committedRemaining: 2, previewRemaining: 3 }, true);
            expect(cell.querySelector('use')?.getAttribute('href')).toBe('#mekbay-infantry-restored-art');
        } finally { jasmine.clock().uninstall(); }
    });

    it('preserves fresh damage across unchanged redraws until strength changes or damage is committed', () => {
        const svg = svgElement('svg');
        const host = svgElement('g');
        svg.appendChild(host);
        const display = createInfantryStrengthDisplay(svg, host);
        const original = { maximum: 4, committedRemaining: 4, previewRemaining: 4 };
        const damaged = { ...original, previewRemaining: 3 };
        display.render(undefined, original, false);
        display.render(undefined, damaged, true);
        const first = display.cells[26]!.element;
        const second = display.cells[27]!.element;
        expect(first.querySelector('.infantry-strength-fresh')).not.toBeNull();

        display.render(undefined, { ...damaged }, true);
        expect(first.querySelector('.infantry-strength-fresh')).not.toBeNull();
        display.render(undefined, { ...damaged, previewRemaining: 2 }, true);
        expect(first.querySelector('.infantry-strength-damaged')).not.toBeNull();
        expect(second.querySelector('.infantry-strength-fresh')).not.toBeNull();
        display.render(undefined, { ...original, committedRemaining: 2, previewRemaining: 2 }, true);
        expect(first.querySelector('.infantry-strength-committed')).not.toBeNull();
        expect(second.querySelector('.infantry-strength-committed')).not.toBeNull();

        display.render(undefined, { ...original, committedRemaining: 2, previewRemaining: 3 }, true);
        expect(second.querySelector('.infantry-strength-restored')).not.toBeNull();
        display.render(undefined, { ...original, committedRemaining: 3, previewRemaining: 3 }, true);
        expect(second.querySelector('.infantry-strength-alive')).not.toBeNull();
    });

    it('keeps generated selections stable when nodes are removed or reordered', () => {
        const svg = svgElement('svg');
        const host = svgElement('g');
        host.id = INFANTRY_STRENGTH_DISPLAY_ID;
        svg.appendChild(host);
        const display = createInfantryStrengthDisplay(svg, host);
        const facts = { maximum: 30, committedRemaining: 25, previewRemaining: 25 };
        display.render(undefined, facts, false);
        const selected = display.cells[12]!;
        const initial = selected.selection();
        display.cells[4]!.element.remove();
        host.prepend(selected.element);
        display.render(undefined, facts, false);
        expect(selected.selection()).toEqual(initial);
        expect(display.cells.length).toBe(30);
        const clone = svg.cloneNode(true) as SVGSVGElement;
        const clonedDisplay = createInfantryStrengthDisplay(clone, clone.getElementById(INFANTRY_STRENGTH_DISPLAY_ID) as SVGGElement);
        clonedDisplay.render(undefined, facts, false);
        expect(clonedDisplay.cells[12]!.selection()).toEqual(initial);
    });

    it('offers every exact strength through the thirty-troop limit', () => {
        const svg = svgElement('svg');
        const host = svgElement('g');
        svg.appendChild(host);
        const display = createInfantryStrengthDisplay(svg, host);
        display.render(undefined, { maximum: 30, committedRemaining: 30, previewRemaining: 30 }, false);
        expect(display.cells.map(cell => cell.selection())).toEqual(Array.from({ length: 30 }, (_, index) => 30 - index));
        display.render(undefined, { maximum: 4, committedRemaining: 4, previewRemaining: 4 }, false);
        expect(display.cells.filter(cell => cell.selection() !== null).map(cell => cell.selection())).toEqual([4, 3, 2, 1]);
    });
});
