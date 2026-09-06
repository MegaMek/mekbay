// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestTankEntity } from '../../models/entity/testing/test-entities';
import { renderGeneratedRecordSheetControls } from './generated-record-sheet-controls';

describe('generated paperdoll hit areas', () => {
    const mounted: SVGSVGElement[] = [];
    afterEach(() => mounted.splice(0).forEach(svg => svg.remove()));

    function sheet(content: string): SVGSVGElement {
        const host = document.createElement('div');
        host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${content}</svg>`;
        const svg = host.querySelector('svg')!;
        document.body.appendChild(svg);
        mounted.push(svg);
        return svg;
    }

    it('combines circles and diamonds into one target with the same occupied areas', () => {
        const svg = sheet(`<g transform="translate(10 20)">
            <circle class="pip armor" data-loc="FR" cx="10" cy="10" r="2"/>
            <circle class="pip armor" data-loc="FR" cx="30" cy="10" r="2"/>
            <polygon class="pip armor" data-loc="FR" points="50,8 52,10 50,12 48,10"/>
        </g>`);
        renderGeneratedRecordSheetControls(svg, new TestTankEntity());
        const target = svg.querySelector<SVGPathElement>('.pip-hit-area.armor')!;

        expect(svg.querySelectorAll('.pip-hit-area').length).toBe(1);
        expect(svg.querySelectorAll('.pip.armor').length).toBe(3);
        expect(target.parentElement?.getAttribute('transform')).toBe('translate(10 20)');
        expect(target.getAttribute('fill')).toBe('transparent');
        expect(target.getAttribute('stroke')).toBe('transparent');
        expect(target.getAttribute('pointer-events')).toBe('all');
        // Test the occupied geometry independently of SVG paint/hit-test state.
        // Browser pointer-through-contour behavior has its own integration suite.
        const path = new Path2D(target.getAttribute('d')!);
        const context = document.createElement('canvas').getContext('2d')!;
        context.lineWidth = Number(target.getAttribute('stroke-width'));
        for (const x of [10, 30, 50]) {
            expect(context.isPointInPath(path, x, 10)).withContext(String(x)).toBeTrue();
            expect(context.isPointInStroke(path, x, 17)).withContext(String(x)).toBeTrue();
        }
        expect(context.isPointInPath(path, 80, 10)).toBeFalse();
        expect(context.isPointInStroke(path, 80, 10)).toBeFalse();
    });

    it('retains separate front, rear, structure, and transformed location targets', () => {
        const svg = sheet(`<g>
            <circle class="pip armor" data-loc="FR" cx="10" cy="10" r="2"/>
            <circle class="pip armor" data-loc="FR" data-rear="1" cx="20" cy="10" r="2"/>
            <circle class="pip structure" data-loc="FR" cx="30" cy="10" r="2"/>
            <polygon class="pip armor" data-loc="FR" transform="rotate(20 40 10)" points="40,8 42,10 40,12 38,10"/>
        </g>`);
        renderGeneratedRecordSheetControls(svg, new TestTankEntity());

        expect(svg.querySelectorAll('.pip-hit-area').length).toBe(4);
        expect(svg.querySelectorAll('.pip-hit-area.armor[data-rear="1"]').length).toBe(1);
        expect(svg.querySelectorAll('.pip-hit-area.structure').length).toBe(1);
        expect(svg.querySelector('.pip-hit-area[transform]')?.getAttribute('transform')).toBe('rotate(20 40 10)');
    });

    it('uses existing contours per location while supplying targets for uncovered facings', () => {
        const svg = sheet(`<path class="unitLocation armor" data-loc="TU" d="M0 0H20V20H0Z"/>
            <g><circle class="pip armor" data-loc="TU" cx="10" cy="10" r="2"/></g>
            <g><circle class="pip armor" data-loc="FR" cx="30" cy="10" r="2"/></g>`);
        renderGeneratedRecordSheetControls(svg, new TestTankEntity());

        expect(svg.querySelector('.pip-hit-area[data-loc="TU"]')).toBeNull();
        expect(svg.querySelector('.pip-hit-area[data-loc="FR"]')).not.toBeNull();
        expect(svg.querySelectorAll('.pip.armor').length).toBe(2);
    });

    it('keeps paperdoll pips inert and places one random-hit control in the layout-reserved space', () => {
        const svg = sheet(`<g data-mekbay-paperdoll="1" data-art-x="10" data-art-y="20" data-art-width="100"
            data-random-hit-transform="translate(140 4) scale(0.75)">
            <path class="unitLocation armor" data-loc="FR" d="M0 0H20V20H0Z"/>
            <circle class="pip armor" data-loc="FR" cx="10" cy="10" r="2"/>
            <circle class="pip structure" data-loc="FR" cx="10" cy="30" r="2"/>
        </g>`);
        renderGeneratedRecordSheetControls(svg, new TestTankEntity());
        renderGeneratedRecordSheetControls(svg, new TestTankEntity());

        expect(svg.querySelector('.pip-hit-area')).toBeNull();
        expect([...svg.querySelectorAll('.pip')].map(pip => pip.getAttribute('pointer-events'))).toEqual(['none', 'none']);
        expect(svg.querySelectorAll('[data-mekbay-random-hit]')).toHaveSize(1);
        expect(svg.querySelector('[data-mekbay-random-hit]')?.getAttribute('transform')).toBe('translate(140 4) scale(0.75)');
    });

    it('preserves an authored control when the layout also supplies a position', () => {
        const svg = sheet(`<g data-mekbay-paperdoll="1" data-random-hit-transform="translate(140 4)">
            <path class="unitLocation armor" data-loc="FR" d="M0 0H20V20H0Z"/>
            <g data-mekbay-random-hit="1" transform="translate(30 50)"><circle cx="14" cy="14" r="15"/></g>
        </g>`);
        renderGeneratedRecordSheetControls(svg, new TestTankEntity());

        expect(svg.querySelectorAll('[data-mekbay-random-hit]')).toHaveSize(1);
        expect(svg.querySelector('[data-mekbay-random-hit]')?.getAttribute('transform')).toBe('translate(30 50)');
    });
});
