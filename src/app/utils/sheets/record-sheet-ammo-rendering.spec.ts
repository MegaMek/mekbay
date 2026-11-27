// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { appendRecordSheetAmmoProfile, updateRecordSheetAmmoProfile } from './record-sheet-ammo-rendering';

describe('record sheet ammo SVG rendering', () => {
    const namespace = 'http://www.w3.org/2000/svg';
    const entries = Array<string>(6).fill('(AC/5) 20');
    const plain = (lines: readonly string[]) => [{ prefix: 'Ammo:', entries: lines, componentIds: [] }];
    let attached: SVGSVGElement[];

    beforeEach(() => attached = []);
    afterEach(() => attached.forEach(svg => svg.remove()));

    function fixture() {
        const svg = document.createElementNS(namespace, 'svg');
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = 'normal normal 8px Roboto, Arial, sans-serif';
        const width = context.measureText(`Ammo: ${entries.slice(0, 3).join(', ')},`).width * 0.9;
        return { svg, options: { x: 10, y: 190, width, fontSize: 8, lineHeight: 12 } };
    }

    function attach(svg: SVGSVGElement): void {
        document.body.appendChild(svg);
        attached.push(svg);
    }

    it('creates no text for an empty ammo profile', () => {
        const { svg, options } = fixture();
        const profile = appendRecordSheetAmmoProfile(svg, plain([]), options);

        expect(profile.childElementCount).toBe(0);
    });

    it('keeps the entire interactive ammo area clickable as row count changes', () => {
        const { svg, options } = fixture();
        svg.setAttribute('width', '300');
        svg.setAttribute('height', '250');
        svg.style.position = 'fixed';
        svg.style.left = '0';
        svg.style.top = '0';
        attach(svg);
        const profile = appendRecordSheetAmmoProfile(svg, plain([]), options);
        updateRecordSheetAmmoProfile(profile, plain(entries), true);
        const hitArea = profile.querySelector<SVGRectElement>('rect')!;
        const bounds = hitArea.getBoundingClientRect();
        // The right edge and interline gap must receive clicks even without text underneath.
        expect(document.elementFromPoint(bounds.right - 1, bounds.top + 12)).toBe(hitArea);

        updateRecordSheetAmmoProfile(profile, plain(['(MG) 100']), true);
        expect(profile.querySelector('rect')).not.toBeNull();
        updateRecordSheetAmmoProfile(profile, plain([]), true);
        expect(profile.childElementCount).toBe(0);
        updateRecordSheetAmmoProfile(profile, plain(entries));
        expect(profile.querySelector('rect')).toBeNull();
    });

    it('adds and removes rows across repeated updates', () => {
        const { svg, options } = fixture();
        const profile = appendRecordSheetAmmoProfile(svg, plain([]), options);

        for (let cycle = 0; cycle < 3; cycle++) {
            updateRecordSheetAmmoProfile(profile, plain(entries));
            expect(profile.querySelectorAll('text').length).toBe(2);

            updateRecordSheetAmmoProfile(profile, plain(['(MG) 100']));
            expect(profile.childElementCount).toBe(1);
            expect(profile.querySelector('text')!.textContent).toBe('Ammo: (MG) 100');

            updateRecordSheetAmmoProfile(profile, plain([]));
            expect(profile.childElementCount).toBe(0);
        }
    });

    it('produces identical rows and compression when detached and attached', () => {
        const { svg, options } = fixture();
        const profile = appendRecordSheetAmmoProfile(svg, plain(entries), options);
        const detachedOutput = profile.outerHTML;

        attach(svg);
        updateRecordSheetAmmoProfile(profile, plain(entries));

        expect(profile.outerHTML).toBe(detachedOutput);
        expect(profile.querySelectorAll('text').length).toBe(2);
    });
});
