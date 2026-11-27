// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { materializeUnitSummaryView } from './unit-summary-view';

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
    const object = value as object;
    seen.add(object);
    for (const nested of Object.values(object)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

describe('materializeUnitSummaryView', () => {
    it('adds transient fields directly to the detached IndexedDB row', () => {
        const summary = createEmptyUnit({
            comp: [{ id: 'laser', q: 1, n: 'Laser', t: 'E', p: 0, l: 'RA', bay: [] }],
            engine: null,
        });

        const view = materializeUnitSummaryView(summary);
        expect(view).toBe(summary);
        expect(view.engine).toBe('');
        expect(Object.prototype.hasOwnProperty.call(view, 'fluff')).toBeFalse();
        expect(view.comp).toBe(summary.comp);
        expect(view.source).toBe(summary.source);
        expect(view.quirks).toBe(summary.quirks);
        expect(view.as.specials).toBe(summary.as.specials);
        expect(view._nameTags).toEqual([]);
        expect(view._chassisTags).toEqual([]);
    });

    it('detaches the mutable Alpha Strike overlay from an immutable provider row', () => {
        const summary = deepFreeze(createEmptyUnit({
            engine: null,
            as: {
                dmg: { dmgS: '1', dmgM: '2', dmgL: '3', dmgE: '4' },
                MVm: { j: 5 },
            },
        }));

        const view = materializeUnitSummaryView(summary);

        expect(view).not.toBe(summary);
        expect(view.as).not.toBe(summary.as);
        expect(view.as.dmg).not.toBe(summary.as.dmg);
        expect(view.as.MVm).not.toBe(summary.as.MVm);
        expect(Object.isExtensible(view.as.dmg)).toBeTrue();
        expect(Object.isExtensible(view.as.MVm)).toBeTrue();
        view.as.dmg._dmgS = 1;
        view.as.MVm[''] = view.as.MVm['j'];
        expect(summary.as.dmg._dmgS).toBeUndefined();
        expect(summary.as.MVm['']).toBeUndefined();
        expect(view.engine).toBe('');
        expect(view._nameTags).toEqual([]);
        expect(Object.isFrozen(summary)).toBeTrue();
    });

    it('rejects a hostile summary carrying deleted native or presentation payloads', () => {
        const hostile = {
            ...createEmptyUnit(),
            fluff: { overview: 'old persisted prose' },
        } as unknown as UnitSummary;
        expect(() => materializeUnitSummaryView(hostile)).toThrowError(/cannot contain native-source fluff or sheet paths/u);
        expect(() => materializeUnitSummaryView({
            ...createEmptyUnit(),
            sheets: ['old.svg'],
        } as unknown as UnitSummary)).toThrowError(/cannot contain native-source fluff or sheet paths/u);
    });
});
