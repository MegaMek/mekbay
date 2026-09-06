// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { RecordSheetRandomHitResult } from './record-sheet-random-hit-result';

describe('RecordSheetRandomHitResult', () => {
    it('creates THROUGH ARMOR over the transformed Mek front view when a rear or external button fires', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 800 1000');
        svg.setAttribute('width', '400');
        svg.setAttribute('height', '500');
        svg.innerHTML = '<g data-mekbay-paperdoll="1" data-mekbay-paperdoll-view="rear" data-type="armor" '
            + 'data-art-x="0" data-art-y="0" data-art-width="80" data-art-height="120" transform="translate(400 20) scale(.5)">'
            + '<g id="rear-button" transform="translate(60 5)"></g>'
            + '<path class="unitLocation armor" data-loc="CT" data-rear="1"></path></g>'
            + '<g transform="translate(30 40) scale(1.5 .75)">'
            + '<g data-mekbay-paperdoll="1" data-mekbay-paperdoll-view="front" data-type="armor" '
            + 'data-art-x="10" data-art-y="20" data-art-width="200" data-art-height="300" transform="translate(10 20) scale(2 3)">'
            + '<path class="unitLocation armor" data-loc="CT"></path></g></g>'
            + '<g id="external-button" transform="translate(600 800)"></g>';
        document.body.appendChild(svg);
        const display = new RecordSheetRandomHitResult();
        try {
            expect(svg.querySelector('.mek-random-hit-result-through-armor')).toBeNull();
            for (const buttonId of ['rear-button', 'external-button']) {
                display.show('unit', svg, svg.querySelector<SVGElement>(`#${buttonId}`)!, 'CT', true, true);
                const label = svg.querySelector<SVGTextElement>('.mek-random-hit-result-through-armor')!;
                expect(label.textContent).toBe('THROUGH ARMOR');
                expect(label.parentNode).toBe(svg.lastElementChild);
                expect(label.getAttribute('x')).toBe('110');
                expect(label.getAttribute('y')).toBe('140');
                expect(label.getAttribute('text-anchor')).toBe('middle');
                expect(label.getAttribute('dominant-baseline')).toBe('central');
                // The front art's local anchor is (375,370) in the sheet, independently of root viewport scaling.
                expect(label.getAttribute('transform')).toBe('matrix(3 0 0 2.25 45 55)');
                expect(svg.querySelectorAll('.mek-random-hit-result-through-armor')).toHaveSize(1);
                expect(svg.querySelector('[data-rear]')?.classList.contains('random-hit-location-highlight')).toBeTrue();
            }
            svg.querySelector('.mek-random-hit-result-through-armor')!
                .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            expect(svg.querySelector('.mek-random-hit-result-through-armor')).toBeNull();
        } finally {
            display.clear();
            svg.remove();
        }
    });

    it('anchors runtime text to the sole non-Mek paperdoll and reads updated fitted art bounds', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '10 20 800 1000');
        svg.setAttribute('width', '400');
        svg.setAttribute('height', '500');
        svg.innerHTML = '<g id="art" data-mekbay-paperdoll="1" data-type="armor" '
            + 'data-art-x="-40" data-art-y="60" data-art-width="240" data-art-height="400" transform="translate(20 30) scale(2 .5)">'
            + '<path class="unitLocation armor" data-loc="FR"></path></g>'
            + '<g id="button" transform="translate(400 800)"></g>';
        document.body.appendChild(svg);
        const display = new RecordSheetRandomHitResult();
        const button = svg.querySelector<SVGElement>('#button')!;
        try {
            expect(svg.querySelector('text')).toBeNull();
            display.show('vehicle', svg, button, 'FR', false, true);
            const label = svg.querySelector<SVGTextElement>('.mek-random-hit-result-through-armor')!;
            expect(label.getAttribute('x')).toBe('80');
            expect(label.getAttribute('y')).toBe('220');
            expect(label.getAttribute('transform')).toBe('matrix(2 0 0 0.5 20 30)');

            const art = svg.querySelector<SVGElement>('#art')!;
            art.dataset['artX'] = '30';
            art.dataset['artY'] = '50';
            art.dataset['artWidth'] = '100';
            art.dataset['artHeight'] = '200';
            display.show('vehicle', svg, button, 'FR', false, true);
            const nextLabel = svg.querySelector<SVGTextElement>('.mek-random-hit-result-through-armor')!;
            expect(nextLabel).not.toBe(label);
            expect(nextLabel.getAttribute('x')).toBe('80');
            expect(nextLabel.getAttribute('y')).toBe('130');
        } finally {
            display.clear();
            svg.remove();
        }
    });

    it('highlights all matching front or rear location fragments and never their pips', () => {
        jasmine.clock().install();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = '<g id="button"></g>'
            + '<path class="unitLocation armor" data-loc="RT"></path>'
            + '<path class="unitLocation armor" data-loc="RT"></path>'
            + '<path class="unitLocation armor" data-loc="RT" data-rear="1"></path>'
            + '<path class="unitLocation structure" data-loc="RT"></path>'
            + '<circle class="pip armor" data-loc="RT"></circle>';
        const display = new RecordSheetRandomHitResult();
        const button = svg.querySelector<SVGElement>('#button')!;
        try {
            display.show('unit', svg, button, 'RT', false, false);
            expect(svg.querySelectorAll('.random-hit-location-highlight')).toHaveSize(2);
            expect(svg.querySelector('.pip')?.classList.contains('random-hit-location-highlight')).toBeFalse();
            display.show('unit', svg, button, 'RT', true, false);
            expect(svg.querySelectorAll('.random-hit-location-highlight')).toHaveSize(1);
            expect(svg.querySelector('[data-rear]')?.classList.contains('random-hit-location-highlight')).toBeTrue();
            jasmine.clock().tick(4000);
            expect(svg.querySelector('.random-hit-location-highlight')).toBeNull();
            expect(svg.querySelector('.mek-random-hit-result')).toBeNull();
            expect(display.unitId).toBeUndefined();
        } finally {
            display.clear();
            jasmine.clock().uninstall();
        }
    });
});
