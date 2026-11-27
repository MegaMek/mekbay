// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { NO_INVENTORY_SELECTION, renderRecordSheetInventorySelection } from './record-sheet-inventory';

describe('record sheet inventory selection', () => {
    function row(): SVGGElement {
        const namespace = 'http://www.w3.org/2000/svg';
        const group = document.createElementNS(namespace, 'g');
        const button = document.createElementNS(namespace, 'rect');
        for (const [name, value] of Object.entries({ x: 10, y: 20, width: 100, height: 8, class: 'inventoryEntryButton mainButton' })) {
            button.setAttribute(name, String(value));
        }
        const name = document.createElementNS(namespace, 'text');
        name.textContent = 'Medium Laser';
        group.append(name, button);
        return group;
    }

    it('stamps a row whose weapons fired this turn over the end of its name, moving nothing', () => {
        const element = row();
        const before = element.querySelector('text')!.outerHTML;

        renderRecordSheetInventorySelection(element, { selected: true, fired: true });
        const stamp = element.querySelector(':scope > .firedStamp')!;
        expect(element.classList.contains('fired')).toBeTrue();
        expect(stamp.querySelector('text')!.textContent).toBe('FIRED');
        // The stamp ends flush with the row's name area and stays inside it.
        const rect = stamp.querySelector('rect')!;
        expect(Number(rect.getAttribute('x')) + Number(rect.getAttribute('width'))).toBe(110);
        expect(Number(rect.getAttribute('x'))).toBeGreaterThan(10);
        expect(element.querySelector('text')!.outerHTML).toBe(before);

        // Rendering again adds no second stamp; End Turn clears the mark.
        renderRecordSheetInventorySelection(element, { selected: true, fired: true });
        expect(element.querySelectorAll('.firedStamp').length).toBe(1);
        renderRecordSheetInventorySelection(element, NO_INVENTORY_SELECTION);
        expect(element.classList.contains('fired')).toBeFalse();
    });
});
