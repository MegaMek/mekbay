// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { renderRecordSheetPips } from '../../components/page-viewer/record-sheet-dom';
import { CapitalShipPipRenderer } from './capital-ship-pip-renderer';
import { createInfantryStrengthDisplay } from './infantry-strength-display';
import { RecordSheetDamageHighlights, type RecordSheetDamageFacts } from './record-sheet-damage-highlights';
import { svgElement } from './record-sheet-svg-rendering';

interface Display {
    render(facts: RecordSheetDamageFacts, markChanges?: boolean): void;
    fresh(): boolean;
    pending(): boolean;
}

const displays: Record<string, (highlights: RecordSheetDamageHighlights) => Display> = {
    'ordinary and critical pips': highlights => {
        const pips = Array.from({ length: 4 }, () => svgElement('circle'));
        return {
            render: (facts, mark = true) => renderRecordSheetPips(highlights, pips,
                facts.maximum, facts.committedRemaining, facts.previewRemaining, mark),
            fresh: () => pips.some(pip => pip.classList.contains('fresh')),
            pending: () => pips.some(pip => pip.classList.contains('pending')),
        };
    },
    'capital grids': highlights => {
        const grid = CapitalShipPipRenderer.createPips(4, 80, 30, 'armor', 'NOS')!;
        const hasPath = (kind: string): boolean => !!grid.querySelector(`.capital-pip-state-${kind}`)?.getAttribute('d');
        return {
            render: (facts, mark = true) => CapitalShipPipRenderer.renderDamage(highlights, [grid],
                facts.maximum, facts.committedRemaining, facts.previewRemaining, mark),
            fresh: () => hasPath('fresh-damage') || hasPath('fresh-repair'),
            pending: () => hasPath('pending-damage') || hasPath('pending-repair') || hasPath('fresh-damage') || hasPath('fresh-repair'),
        };
    },
    infantry: highlights => {
        const svg = svgElement('svg');
        const host = svgElement('g');
        svg.appendChild(host);
        const display = createInfantryStrengthDisplay(svg, host, highlights);
        return {
            render: (facts, mark = true) => display.render(undefined, facts, mark),
            fresh: () => host.querySelector('.infantry-strength-fresh') !== null,
            pending: () => host.querySelector('.infantry-strength-damaged,.infantry-strength-fresh') !== null,
        };
    },
};

describe('record-sheet damage highlight lifetime', () => {
    let highlights: RecordSheetDamageHighlights;
    const intact = { maximum: 4, committedRemaining: 4, previewRemaining: 4 };
    const damaged = { ...intact, previewRemaining: 3 };
    beforeEach(() => {
        jasmine.clock().install();
        highlights = new RecordSheetDamageHighlights();
    });
    afterEach(() => {
        highlights.destroy();
        jasmine.clock().uninstall();
    });

    for (const [name, create] of Object.entries(displays)) {
        it(`expires ${name} after 3 seconds without extending on redraw or losing pending damage`, () => {
            const display = create(highlights);
            display.render(intact, false);
            display.render(damaged);
            jasmine.clock().tick(2000);
            display.render({ ...damaged });
            jasmine.clock().tick(999);
            expect(display.fresh()).toBeTrue();
            jasmine.clock().tick(1);
            expect(display.fresh()).toBeFalse();
            expect(display.pending()).toBeTrue();
            display.render({ ...damaged });
            expect(display.fresh()).toBeFalse();
        });

        for (const duration of [0, -1]) {
            it(`keeps ${name} fresh with duration ${duration} until commit`, () => {
                highlights.destroy();
                highlights = new RecordSheetDamageHighlights(duration);
                const display = create(highlights);
                display.render(intact, false);
                display.render(damaged);
                jasmine.clock().tick(60_000);
                display.render({ ...damaged });
                expect(display.fresh()).toBeTrue();
                display.render({ ...damaged, committedRemaining: 3 });
                expect(display.fresh()).toBeFalse();
                expect(display.pending()).toBeFalse();
            });
        }

        it(`gives a subsequent ${name} change its own duration and cancels expired callbacks on destroy`, () => {
            const display = create(highlights);
            display.render(intact, false);
            display.render(damaged);
            jasmine.clock().tick(2000);
            display.render({ ...damaged, previewRemaining: 2 });
            jasmine.clock().tick(1000);
            expect(display.fresh()).toBeTrue();
            highlights.destroy();
            jasmine.clock().tick(60_000);
            expect(display.fresh()).toBeTrue();
        });
    }
});
