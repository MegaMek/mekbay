// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AS_SERIALIZED_GROUP_SCHEMA, CBT_SERIALIZED_GROUP_SCHEMA, CBT_SERIALIZED_STATE_SCHEMA, C3_NETWORK_GROUP_SCHEMA, CRIT_SLOT_SCHEMA, FORCE_TAG_MAX_COUNT, HEAT_SCHEMA, sanitizeForceTagLabels, sanitizeForceTags, TURN_STATE_SCHEMA } from './force-serialization';
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

describe('formation target serialization', () => {
    it('preserves a string target id in both game-system group schemas', () => {
        const group = { id: 'support', formationTargetGroupId: 'target', units: [] };

        expect(Sanitizer.sanitize(group, CBT_SERIALIZED_GROUP_SCHEMA).formationTargetGroupId).toBe('target');
        expect(Sanitizer.sanitize(group, AS_SERIALIZED_GROUP_SCHEMA).formationTargetGroupId).toBe('target');
    });

    it('drops malformed target ids without changing the schema version', () => {
        const group = { id: 'support', formationTargetGroupId: 7, units: [] };

        expect(Sanitizer.sanitize(group, AS_SERIALIZED_GROUP_SCHEMA).formationTargetGroupId).toBeUndefined();
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
            standAttempts: Number.NaN,
            cover: Number.NaN,
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

    it('sanitizes turn chronology as non-negative integer counters', () => {
        expect(Sanitizer.sanitize({ turnCounter: 4.9 }, TURN_STATE_SCHEMA))
            .toEqual({ turnCounter: 4 });
        expect(Sanitizer.sanitize({ turnCounter: -2 }, TURN_STATE_SCHEMA))
            .toEqual({ turnCounter: 0 });
        expect(Sanitizer.sanitize({ turnCounter: Number.NaN }, TURN_STATE_SCHEMA))
            .toEqual({});

        expect(Sanitizer.sanitize({ id: 'crit', destroyedTurn: 7.8 }, CRIT_SLOT_SCHEMA))
            .toEqual({ id: 'crit', destroyedTurn: 7 });
        expect(Sanitizer.sanitize({ id: 'crit', destroyedTurn: Number.POSITIVE_INFINITY }, CRIT_SLOT_SCHEMA))
            .toEqual({ id: 'crit' });
    });

    it('accepts only resumable end-turn checkpoints', () => {
        expect(Sanitizer.sanitize({ endTurnCheckpoint: 'phase-ended' }, TURN_STATE_SCHEMA))
            .toEqual({ endTurnCheckpoint: 'phase-ended' });
        expect(Sanitizer.sanitize({ endTurnCheckpoint: 'heat-staged' }, TURN_STATE_SCHEMA))
            .toEqual({ endTurnCheckpoint: 'heat-staged' });
        expect(Sanitizer.sanitize({ endTurnCheckpoint: 'complete' }, TURN_STATE_SCHEMA))
            .toEqual({});
        expect(Sanitizer.sanitize({ endTurnCheckpoint: true }, TURN_STATE_SCHEMA))
            .toEqual({});
    });

    it('sanitizes consumed heat dissipation as a non-negative finite number', () => {
        expect(Sanitizer.sanitize({ heatDissipationConsumed: '6' }, TURN_STATE_SCHEMA)).toEqual({
            heatDissipationConsumed: 6,
        });
        expect(Sanitizer.sanitize({ heatDissipationConsumed: -2 }, TURN_STATE_SCHEMA)).toEqual({
            heatDissipationConsumed: 0,
        });
    });

    it('preserves zero stand attempts and clamps negative values', () => {
        expect(Sanitizer.sanitize({ standAttempts: 0 }, TURN_STATE_SCHEMA)).toEqual({
            standAttempts: 0,
        });
        expect(Sanitizer.sanitize({ standAttempts: -2 }, TURN_STATE_SCHEMA)).toEqual({
            standAttempts: 0,
        });
    });

    it('keeps only active cover values', () => {
        expect(Sanitizer.sanitize({ cover: 0 }, TURN_STATE_SCHEMA)).toEqual({});
        expect(Sanitizer.sanitize({ cover: 1 }, TURN_STATE_SCHEMA)).toEqual({ cover: 1 });
        expect(Sanitizer.sanitize({ cover: 3 }, TURN_STATE_SCHEMA)).toEqual({ cover: 3 });
        expect(Sanitizer.sanitize({ cover: 4 }, TURN_STATE_SCHEMA)).toEqual({ cover: 4 });
        expect(Sanitizer.sanitize({ cover: 5 }, TURN_STATE_SCHEMA)).toEqual({ cover: 5 });
        expect(Sanitizer.sanitize({ cover: 6 }, TURN_STATE_SCHEMA)).toEqual({ cover: 6 });
        expect(Sanitizer.sanitize({ cover: 7 }, TURN_STATE_SCHEMA)).toEqual({ cover: 7 });
        expect(Sanitizer.sanitize({ cover: 8 }, TURN_STATE_SCHEMA)).toEqual({ cover: 8 });
        expect(Sanitizer.sanitize({ cover: 9 }, TURN_STATE_SCHEMA)).toEqual({});
        expect(Sanitizer.sanitize({ cover: '3' }, TURN_STATE_SCHEMA)).toEqual({});
        expect(Sanitizer.sanitize({ cover: 1.5 }, TURN_STATE_SCHEMA)).toEqual({});
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

    it('sanitizes one ordered pending-event queue with strict kind-specific payloads', () => {
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
                    type: 'unit-check',
                    id: 'check:2',
                    kind: 'heat-life-support',
                    result: { kind: 'automatic', outcome: 'failed' },
                    hits: 2,
                },
                {
                    type: 'unit-check',
                    id: 'check:restart',
                    kind: 'shutdown-recovery',
                    target: 6,
                    result: { kind: 'roll', dice: [3, 4] },
                },
                {
                    type: 'mek-fall',
                    id: 'fall:1',
                    source: 'stand-attempt',
                    levelsFallen: 1,
                },
                {
                    type: 'mek-critical-chance',
                    id: 'chance:1',
                    location: ' CT ',
                    consolidateImmediately: true,
                    explosionProtection: 'case-ii',
                    hardenedArmorApplies: false,
                    throughArmorHitArc: 'rear',
                    roll: [5, 5],
                    result: 2,
                    pilotDamageGroup: ' turn-closed:immediate:end-turn:heat ',
                },
                {
                    type: 'mek-critical-hit',
                    id: 'critical:1',
                    location: ' LT ',
                    targetLocation: ' CT ',
                    remainingHits: 2,
                    locationDestroyed: true,
                    chanceOrigin: {
                        explosionProtection: 'case',
                        hardenedArmorApplies: true,
                    },
                    caseII: { status: 'passed' },
                    roll: [3, 4],
                },
                {
                    type: 'unit-check',
                    id: 'check:3',
                    kind: 'seatbelt',
                    crewId: 0,
                    target: 5,
                },
                {
                    type: 'mek-critical-hit',
                    id: 'critical:floating',
                    location: 'RT',
                    targetLocation: 'RT',
                    remainingHits: 1,
                    chanceOrigin: { throughArmorHitArc: 'right' },
                    floatingLocation: {
                        hitArc: 'right',
                        locationRoll: 9,
                        dice: [4, 5],
                    },
                },
                { type: 'unit-check', id: 'check:1', kind: 'heat-shutdown', target: 5 },
                { type: 'unknown', id: 'unknown:1' },
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
                    type: 'unit-check',
                    id: 'check:2',
                    kind: 'heat-life-support',
                    result: { kind: 'automatic', outcome: 'failed' },
                    hits: 2,
                },
                {
                    type: 'unit-check',
                    id: 'check:restart',
                    kind: 'shutdown-recovery',
                    target: 6,
                    result: { kind: 'roll', dice: [3, 4] },
                },
                { type: 'mek-fall', id: 'fall:1', source: 'stand-attempt', levelsFallen: 1 },
                {
                    type: 'mek-critical-chance',
                    id: 'chance:1',
                    location: 'CT',
                    consolidateImmediately: true,
                    explosionProtection: 'case-ii',
                    hardenedArmorApplies: false,
                    throughArmorHitArc: 'rear',
                    roll: [5, 5],
                    result: 2,
                    pilotDamageGroup: 'turn-closed:immediate:end-turn:heat',
                },
                {
                    type: 'mek-critical-hit',
                    id: 'critical:1',
                    location: 'LT',
                    targetLocation: 'CT',
                    remainingHits: 2,
                    locationDestroyed: true,
                    chanceOrigin: {
                        explosionProtection: 'case',
                        hardenedArmorApplies: true,
                    },
                    caseII: { status: 'passed' },
                    roll: [3, 4],
                },
                {
                    type: 'unit-check',
                    id: 'check:3',
                    kind: 'seatbelt',
                    crewId: 0,
                    target: 5,
                },
                {
                    type: 'mek-critical-hit',
                    id: 'critical:floating',
                    location: 'RT',
                    targetLocation: 'RT',
                    remainingHits: 1,
                    chanceOrigin: { throughArmorHitArc: 'right' },
                    floatingLocation: {
                        hitArc: 'right',
                        locationRoll: 9,
                        dice: [4, 5],
                    },
                },
            ],
        });
    });

    it('rejects malformed events atomically and ignores removed split-array APIs', () => {
        expect(Sanitizer.sanitize({
            pendingEvents: [
                { type: 'unit-check', id: 'bad:1', kind: 'seatbelt', target: 5 },
                { type: 'unit-check', id: 'bad:2', kind: 'heat-shutdown', result: { kind: 'manual', outcome: 'failed' } },
                { type: 'mek-critical-hit', id: 'bad:3', location: 'CT', targetLocation: 'CT', remainingHits: 0 },
                {
                    type: 'mek-critical-hit',
                    id: 'bad:origin',
                    location: 'CT',
                    targetLocation: 'CT',
                    remainingHits: 1,
                    chanceOrigin: { hardenedArmorApplies: 'yes' },
                },
                {
                    type: 'mek-critical-hit',
                    id: 'bad:floating',
                    location: 'RT',
                    targetLocation: 'RT',
                    remainingHits: 1,
                    floatingLocation: { hitArc: 'right', locationRoll: 9, dice: [6, 6] },
                },
                { type: 'mek-critical-chance', id: 'bad:4', location: 'CT', result: 5 },
                { type: 'mek-fall', id: 'bad:5', source: 'manual', levelsFallen: 0 },
            ],
            pendingUnitChecks: [{ id: 'legacy:1' }],
            pendingCriticals: [{ id: 'legacy:2' }],
            pendingCriticalChances: [{ id: 'legacy:3' }],
        }, TURN_STATE_SCHEMA)).toEqual({});
    });

    it('preserves an empty critical-chance origin because its presence is the undo marker', () => {
        expect(Sanitizer.sanitize({
            pendingEvents: [{
                type: 'mek-critical-hit',
                id: 'critical:undo',
                location: 'CT',
                targetLocation: 'CT',
                remainingHits: 1,
                chanceOrigin: {},
            }],
        }, TURN_STATE_SCHEMA)).toEqual({
            pendingEvents: [{
                type: 'mek-critical-hit',
                id: 'critical:undo',
                location: 'CT',
                targetLocation: 'CT',
                remainingHits: 1,
                chanceOrigin: {},
            }],
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
