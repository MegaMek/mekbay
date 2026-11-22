// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    suggestedVelocityRecordValue,
    velocityRecordEntryIssue,
    withVelocityRecordValue,
    type VelocityRecordEntry,
} from './aerospace-velocity-record.model';

describe('aerospace velocity record model', () => {
    const record: readonly VelocityRecordEntry[] = [
        { turn: 1, field: 'thrust', value: 3 },
        { turn: 1, field: 'velocity', value: 3 },
        { turn: 3, field: 'velocity', value: 5 },
    ];

    it('suggests the latest earlier value of a row, or the turn velocity for effective velocity', () => {
        expect(suggestedVelocityRecordValue(record, 2, 'velocity')).toBe(3);
        expect(suggestedVelocityRecordValue(record, 4, 'velocity')).toBe(5);
        expect(suggestedVelocityRecordValue(record, 3, 'velocity')).toBe(5);
        expect(suggestedVelocityRecordValue(record, 3, 'effectiveVelocity')).toBe(5);
        expect(suggestedVelocityRecordValue(record, 2, 'altitude')).toBe(0);
    });

    it('keeps the selected airship speed for four turns and suggests whole thrust from the velocity table', () => {
        for (const [speed, pattern] of [[0.25, [1, 0, 0, 0]], [0.5, [1, 0, 1, 0]], [1.75, [2, 1, 2, 2]]] as const) {
            const entries = withVelocityRecordValue([], 5, 'velocity', speed, true);
            expect(entries.map(entry => entry.value)).toEqual([speed, speed, speed, speed]);
            expect(entries.map(entry => suggestedVelocityRecordValue(entries, entry.turn, 'thrust', true))).toEqual([...pattern]);
            expect(velocityRecordEntryIssue(entries[0], true)).toBeNull();
            expect(velocityRecordEntryIssue(entries[0])).not.toBeNull();
        }
        expect(velocityRecordEntryIssue({ turn: 1, field: 'altitude', value: 0.5 }, true)).not.toBeNull();
        expect(velocityRecordEntryIssue({ turn: 1, field: 'velocity', value: 0.2 }, true)).not.toBeNull();
    });

    it('sets and clears single cells in turn and row order', () => {
        const set = withVelocityRecordValue(record, 1, 'altitude', 7);
        expect(set.map(entry => `${entry.turn}:${entry.field}=${entry.value}`))
            .toEqual(['1:thrust=3', '1:velocity=3', '1:altitude=7', '3:velocity=5']);
        expect(withVelocityRecordValue(set, 1, 'velocity', null).some(entry => entry.field === 'velocity' && entry.turn === 1))
            .toBeFalse();
    });

    it('accepts only whole values, in any turn from 1', () => {
        expect(velocityRecordEntryIssue({ turn: 20, field: 'altitude', value: 10 })).toBeNull();
        expect(velocityRecordEntryIssue({ turn: 37, field: 'altitude', value: 1 })).toBeNull();
        expect(velocityRecordEntryIssue({ turn: 0, field: 'altitude', value: 1 })).toContain('turns');
        expect(velocityRecordEntryIssue({ turn: 1, field: 'velocity', value: -1 })).toContain('values');
        expect(velocityRecordEntryIssue({ turn: 1, field: 'velocity', value: 1.5 })).toContain('values');
    });
});
