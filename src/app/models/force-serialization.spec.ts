// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    AS_SERIALIZED_GROUP_SCHEMA,
    CBT_SERIALIZED_GROUP_SCHEMA,
    CBT_SERIALIZED_STATE_SCHEMA,
    C3_NETWORK_GROUP_SCHEMA,
    CRIT_SLOT_SCHEMA,
    FORCE_TAG_MAX_COUNT,
    HEAT_SCHEMA,
    sanitizeForceTagLabels,
    sanitizeForceTags,
    TURN_STATE_SCHEMA,
} from './force-serialization';
import { Sanitizer } from '../utils/sanitizer.util';
import { C3NetworkType } from './c3-network.model';

describe('C3 network serialization compatibility', () => {
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

describe('production V1 formation-target serialization', () => {
    it('preserves a string target id in both game-system group schemas', () => {
        const group = { id: 'support', formationTargetGroupId: 'target', units: [] };

        expect(Sanitizer.sanitize(group, CBT_SERIALIZED_GROUP_SCHEMA).formationTargetGroupId).toBe('target');
        expect(Sanitizer.sanitize(group, AS_SERIALIZED_GROUP_SCHEMA).formationTargetGroupId).toBe('target');
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

        expect(tags).toEqual(manyTags.slice(0, FORCE_TAG_MAX_COUNT));
        expect(tags).not.toContain('aa');
        expect(tags).not.toContain('zz');
    });
});

describe('heat state sanitization', () => {
    it('discards malformed optional values instead of creating a zero target', () => {
        expect(Sanitizer.sanitize({ current: 4, previous: 3, next: 'invalid', heatsinksOff: Infinity }, HEAT_SCHEMA)).toEqual({
            current: 4,
            previous: 3,
        });

        expect(Sanitizer.sanitize({
            moveDistance: 'invalid',
            dmgReceived: Number.NaN,
            weaponsHeat: Number.POSITIVE_INFINITY,
            heatDissipationConsumed: Number.POSITIVE_INFINITY,
        }, TURN_STATE_SCHEMA)).toEqual({});
    });

    it('normalizes valid optional numeric values to non-negative values', () => {
        expect(Sanitizer.sanitize({ current: 4, previous: 3, next: '7', heatsinksOff: -2 }, HEAT_SCHEMA)).toEqual({
            current: 4,
            previous: 3,
            next: 7,
            heatsinksOff: 0,
        });
    });

    it('sanitizes consumed heat dissipation as a non-negative finite number', () => {
        expect(Sanitizer.sanitize({ heatDissipationConsumed: '6' }, TURN_STATE_SCHEMA)).toEqual({
            heatDissipationConsumed: 6,
        });
        expect(Sanitizer.sanitize({ heatDissipationConsumed: -2 }, TURN_STATE_SCHEMA)).toEqual({
            heatDissipationConsumed: 0,
        });
    });

    it('imports the latest V1 turn chronology, cover, stand, and critical timestamp fields', () => {
        expect(Sanitizer.sanitize({
            turnCounter: 4.9,
            endTurnCheckpoint: 'heat-staged',
            standAttempts: 2,
            carefulStand: true,
            cover: 3,
        }, TURN_STATE_SCHEMA)).toEqual({
            turnCounter: 4,
            endTurnCheckpoint: 'heat-staged',
            standAttempts: 2,
            carefulStand: true,
            cover: 3,
        });
        expect(Sanitizer.sanitize({ id: 'crit', destroyedTurn: 7.8 }, CRIT_SLOT_SCHEMA))
            .toEqual({ id: 'crit', destroyedTurn: 7 });
    });

    it('imports the latest V1 pending-event union without obsolete UI fields', () => {
        expect(Sanitizer.sanitize({
            pendingEvents: [
                {
                    type: 'unit-check',
                    id: ' check:1 ',
                    kind: 'consciousness',
                    pilotDamageGroup: ' P ',
                    crewId: 2,
                    target: 7,
                    result: { kind: 'roll', dice: [3, 2] },
                    description: 'not persisted',
                },
                {
                    type: 'mek-critical-hit',
                    id: 'critical:1',
                    location: ' LT ',
                    targetLocation: ' CT ',
                    remainingHits: 2,
                    chanceOrigin: {},
                    caseII: { status: 'passed' },
                    roll: [3, 4],
                },
            ],
        }, TURN_STATE_SCHEMA)).toEqual({
            pendingEvents: [
                {
                    type: 'unit-check',
                    id: 'check:1',
                    kind: 'consciousness',
                    pilotDamageGroup: 'P',
                    crewId: 2,
                    target: 7,
                    result: { kind: 'roll', dice: [3, 2] },
                },
                {
                    type: 'mek-critical-hit',
                    id: 'critical:1',
                    location: 'LT',
                    targetLocation: 'CT',
                    remainingHits: 2,
                    chanceOrigin: {},
                    caseII: { status: 'passed' },
                    roll: [3, 4],
                },
            ],
        });
    });

    it('normalizes PSR locations and rejects non-positive or fractional hit counts', () => {
        expect(Sanitizer.sanitize({
            psrChecks: {
                legActuators: { ' LL ': 2, RL: -1, LA: 0, RA: 1.5 }
            }
        }, TURN_STATE_SCHEMA)).toEqual({
            psrChecks: { legActuators: { LL: 2 } }
        });
    });

    it('keeps valid PSR outcomes and rejects malformed outcomes', () => {
        expect(Sanitizer.sanitize({
            psrOutcomes: {
                first: 'success',
                second: 'failed',
                invalid: 'pending',
                numeric: 1,
            },
        }, TURN_STATE_SCHEMA)).toEqual({
            psrOutcomes: { first: 'success', second: 'failed' },
        });
    });
});

describe('rule check sanitization', () => {
    it('preserves valid records and rejects malformed records', () => {
        const sanitized = Sanitizer.sanitize({
            modified: false,
            destroyed: false,
            crew: [],
            crits: [],
            locations: {},
            heat: { current: 0, previous: 0 },
            ruleChecks: {
                valid: { token: 'token-1', trigger: 'LT', status: 'success' },
                invalidStatus: { token: 'token-2', trigger: 'RT', status: 'ignored' },
                missingToken: { trigger: 'CT', status: 'failed' },
                missingTrigger: { token: 'token-3', status: 'pending' },
            },
        }, CBT_SERIALIZED_STATE_SCHEMA);

        expect(sanitized.ruleChecks).toEqual({
            valid: { token: 'token-1', trigger: 'LT', status: 'success' },
        });
    });
});
