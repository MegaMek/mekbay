// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { alphaStrikeCardFileName, snapshotAlphaStrikeCard } from './alpha-strike-card-export.util';

describe('Alpha Strike card export', () => {
    it('names the export after the unit, with characters a file system rejects replaced', () => {
        expect(alphaStrikeCardFileName('Astrolux LC-100')).toBe('Astrolux-LC-100-alpha-strike');
        expect(alphaStrikeCardFileName(' Atlas AS7-D "Danielle" ')).toBe('Atlas-AS7-D-Danielle-alpha-strike');
        expect(alphaStrikeCardFileName('***')).toBe('unit-alpha-strike');
    });

    it('exports the displayed card at its viewBox size, its colors fixed, local references kept, without screen-only parts', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 350 250');
        svg.style.width = '100%';
        svg.innerHTML = '<defs><clipPath id="card-clip"><rect width="1" height="1"/></clipPath></defs>'
            + '<rect class="body" clip-path="url(#card-clip)" style="fill: rgb(1, 2, 3)"/>'
            + '<g class="screen-only"/><g data-screen-only=""/>';
        document.body.appendChild(svg);
        try {
            const card = snapshotAlphaStrikeCard(svg);
            const body = card.querySelector<SVGRectElement>('rect.body')!;

            expect([card.getAttribute('width'), card.getAttribute('height'), card.style.width]).toEqual(['350', '250', '']);
            expect(body.style.getPropertyValue('fill')).toBe('rgb(1, 2, 3)');
            expect(body.style.getPropertyValue('clip-path')).toBe('url("#card-clip")');
            expect(card.querySelector('.screen-only, [data-screen-only]')).toBeNull();
        } finally {
            svg.remove();
        }
    });
});
