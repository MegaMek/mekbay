// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { SanitizationError, Sanitizer } from './sanitizer.util';

describe('Sanitizer schema defaults', () => {
    const schema = Sanitizer.schema<{ name: string; count: number; empty?: null; omitted?: string }>()
        .string('name', { default: 'Untitled' })
        .number('count', { default: 0 })
        .any('empty', null)
        .string('omitted')
        .build();

    it('recovers explicit defaults from non-object input, including null and zero', () => {
        expect(Sanitizer.sanitize(null, schema)).toEqual({ name: 'Untitled', count: 0, empty: null });
        expect(() => Sanitizer.sanitize(null, schema, { strict: true }))
            .toThrowError(SanitizationError, 'Input must be a plain object');
    });

    it('applies the existing null-removal option to object input', () => {
        expect(Sanitizer.sanitize({}, schema)).toEqual({ name: 'Untitled', count: 0 });
        expect(Sanitizer.sanitize({}, schema, { removeNulls: false }))
            .toEqual({ name: 'Untitled', count: 0, empty: null });
    });

    it('uses the same schema rules for nested objects, arrays and records', () => {
        const nested = Sanitizer.schema<{ item: object; items: object[]; byId: Record<string, object> }>()
            .object('item', schema)
            .array('items', schema)
            .record('byId', schema)
            .build();
        const input = { name: 'Scout', count: '3', extra: 'discarded' };
        const expected = { name: 'Scout', count: 3 };
        expect(Sanitizer.sanitize({ item: input, items: [input], byId: { alpha: input } }, nested))
            .toEqual({ item: expected, items: [expected], byId: { alpha: expected } });
    });
});
