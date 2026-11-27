// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    AS_SERIALIZED_FORCE_SCHEMA,
    AS_SERIALIZED_STATE_SCHEMA,
    C3_NETWORK_GROUP_SCHEMA,
    sanitizeForceTagLabels,
    sanitizeForceTags,
} from './force-serialization';
import { Sanitizer } from '../utils/sanitizer.util';
import { C3NetworkType } from './c3-network.model';
import { GameSystem } from './common.model';

describe('C3 network serialization', () => {
    it('preserves peer IDs as ordered bare strings', () => {
        const serialized = {
            id: 'peer-network', type: C3NetworkType.C3I, color: '#1565C0',
            peerIds: ['alpha', 'bravo'],
        };

        const sanitized = Sanitizer.sanitize(serialized, C3_NETWORK_GROUP_SCHEMA);

        expect(sanitized).toEqual(serialized);
        expect(JSON.stringify(sanitized)).toBe(JSON.stringify(serialized));
    });

    it('preserves bare slaves and exact zero-based master members', () => {
        const serialized = {
            id: 'hierarchy', type: C3NetworkType.C3, color: '#2E7D32',
            masterId: 'sunder', masterCompIndex: 0,
            members: ['atlas', 'sunder:1'],
        };

        const sanitized = Sanitizer.sanitize(serialized, C3_NETWORK_GROUP_SCHEMA);

        expect(sanitized).toEqual(serialized);
        expect(JSON.stringify(sanitized)).toBe(JSON.stringify(serialized));
    });

    it('keeps shallow sanitation separate from semantic validation', () => {
        expect(Sanitizer.sanitize({
            id: 'unknown', type: 'unknown' as C3NetworkType, color: '#C62828',
            peerIds: ['alpha', 7, 'bravo'], masterCompIndex: 'invalid',
        }, C3_NETWORK_GROUP_SCHEMA)).toEqual({
            id: 'unknown', type: 'unknown' as C3NetworkType, color: '#C62828',
            peerIds: ['alpha', 'bravo'],
            masterCompIndex: 0,
        });
    });
});

describe('Alpha Strike formation-target serialization', () => {
    it('preserves a string target id', () => {
        const force = {
            version: 2,
            timestamp: '2026-01-01T00:00:00.000Z',
            instanceId: 'force',
            type: GameSystem.AS,
            name: 'Force',
            groups: [{ id: 'support', formationTargetGroupId: 'target', units: [] }],
        };

        expect(Sanitizer.sanitize(force, AS_SERIALIZED_FORCE_SCHEMA).groups[0].formationTargetGroupId).toBe('target');
    });
});

describe('force tag sanitization', () => {
    const manyTags = [
        '11', '12', '123', '13', '133', '14', '15', '16', '17', '18', '19', '233',
        '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35',
        '36', '37', '38', '39', '40', '41', '443', 'a', 'aa', 'b', 'bbbb', 'c',
        'cccc', 'd', 'e', 'er', 'f', 'g', 'zz',
    ];

    it('keeps all force tag labels for global catalogs', () => {
        const labels = sanitizeForceTagLabels(manyTags);

        expect(labels.length).toBe(manyTags.length);
        expect(labels).toContain('aa');
        expect(labels).toContain('zz');
    });

    it('still applies the per-force tag count limit to assigned force tags', () => {
        const tags = sanitizeForceTags(manyTags);

        expect(tags.length).toBeLessThan(manyTags.length);
        expect(tags).toEqual(manyTags.slice(0, tags.length));
        expect(tags).not.toContain('aa');
        expect(tags).not.toContain('zz');
    });
});

describe('unit condition sanitization', () => {
    it('keeps exact typed keys and drops aliases or normalized spellings', () => {
        const sanitized = Sanitizer.sanitize({
            conditions: [
                'prone',
                ' prone ',
                'immobilized',
                { key: 'jammed', pending: true },
                { state: 'tagged' },
                { key: 'not-a-condition' },
            ],
        }, AS_SERIALIZED_STATE_SCHEMA);

        expect(sanitized.conditions).toEqual([
            { key: 'jammed', pending: true },
            'prone',
        ]);
    });
});
