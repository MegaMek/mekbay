// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    formatRuntimeHistoryMessage,
    RUNTIME_HISTORY_MESSAGE,
    runtimeHistoryMessageUnitId,
    type RuntimeHistoryFormatContext,
    type SerializedRuntimeHistoryMessage,
} from './runtime-history';

const CONTEXT: RuntimeHistoryFormatContext = {
    unitLabel: () => 'King Crab KGC-000',
    targetLabel: (_instanceId, kind) => kind === 'critical'
        ? 'AC/20 at Right Arm slot 8'
        : kind === 'component'
            ? 'Autocannon/20'
        : 'Right Leg',
    crewLabel: () => 'Pilot',
    ammoLabel: () => 'Precision AC/20 Ammo',
    omitUnitLabel: true,
};

describe('runtime history messages', () => {
    it('formats compact damage and critical targets as user-facing Entity labels', () => {
        expect(format([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            'unit:king-crab',
            'f:rl',
            12,
            'pending',
        ])).toBe('12 armor damage at Right Leg (pending)');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL,
            'unit:king-crab',
            's:ra:7',
            1,
            'pending',
        ])).toBe('Critical hit on AC/20 at Right Arm slot 8 (pending)');
    });

    it('shows heat, crew-state, and crew-skill changes with before and after values', () => {
        expect(format([
            RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED,
            'unit:king-crab',
            0,
            5,
            19,
        ])).toBe('Heat 5 → 19');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.CREW_CHANGED,
            'unit:king-crab',
            0,
            0,
            1,
            0,
            1,
        ])).toBe('Pilot: hits 0 → 1; state conscious → unconscious');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
            'unit:king-crab',
            0,
            1,
            5,
            4,
        ])).toBe('Pilot: Piloting skill 5 → 4');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.CREW_CHANGED,
            'unit:king-crab',
            0,
            0,
            0,
            4,
            5,
        ])).toBe('Pilot: state killed → stunned');
    });

    it('describes location conditions and Mek actions instead of command names', () => {
        expect(format([
            RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED,
            'unit:king-crab',
            'i:rl',
            'blown-off',
            0,
            1,
            'pending',
        ])).toBe('Right Leg blown off (pending)');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED,
            'unit:king-crab',
            'i:rl',
            'blown-off',
            1,
            0,
            'pending',
        ])).toBe('Right Leg reattached (pending)');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED,
            'unit:king-crab',
            'i:rl',
            'narc',
            3,
            2,
            'committed',
        ])).toBe('NARC pod removed from Right Leg (2 remaining)');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED,
            'unit:king-crab',
            'i:rl',
            'narc',
            0,
            1,
            'committed',
        ])).toBe('NARC pod attached to Right Leg');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED,
            'unit:king-crab',
            0,
            1,
        ])).toBe('Shut down');
    });

    it('describes movement and airborne selections semantically', () => {
        expect(format([
            RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED,
            'unit:king-crab',
            0,
            0,
            3,
            5,
        ])).toBe('Declared Run 5 hexes');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED,
            'unit:king-crab',
            3,
            5,
            0,
            0,
        ])).toBe('Cleared movement');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED,
            'unit:king-crab',
            -1,
            1,
        ])).toBe('Declared airborne');
    });

    it('names each fired weapon, its ammunition, and component mode transition', () => {
        expect(format([
            RUNTIME_HISTORY_MESSAGE.WEAPONS_FIRED,
            'unit:king-crab',
            'c:ac20',
            'ISAC20PrecisionAmmo',
        ])).toBe('Fired Autocannon/20 using Precision AC/20 Ammo');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.WEAPONS_FIRED,
            'unit:king-crab',
            'c:ac20',
        ])).toBe('Fired Autocannon/20');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED,
            'unit:king-crab',
            'c:ac20',
            'Single',
            'Rapid',
        ])).toBe('Autocannon/20 mode: Single → Rapid');
    });

    it('describes spotting and every compact cover value', () => {
        expect(format([
            RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED,
            'unit:king-crab',
            false,
            true,
        ])).toBe('Declared spotting');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED,
            'unit:king-crab',
            true,
            false,
        ])).toBe('Stopped spotting');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            'unit:king-crab',
            0,
            1,
        ])).toBe('Declared light cover');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            'unit:king-crab',
            1,
            2,
        ])).toBe('Declared heavy cover');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            'unit:king-crab',
            2,
            4,
        ])).toBe('Declared cover water depth 2');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            'unit:king-crab',
            4,
            6,
        ])).toBe('Declared cover building level 1');
        expect(format([
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            'unit:king-crab',
            6,
            0,
        ])).toBe('Cleared cover');
    });

    it('identifies only expanded unit-scoped messages', () => {
        expect(runtimeHistoryMessageUnitId([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_INTERNAL,
            'unit:king-crab',
            'i:ll',
            6,
        ])).toBe('unit:king-crab');
        expect(runtimeHistoryMessageUnitId([
            RUNTIME_HISTORY_MESSAGE.FORCE_ACTION,
            'repair-units',
        ])).toBeNull();
    });
});

function format(message: SerializedRuntimeHistoryMessage): string {
    return formatRuntimeHistoryMessage(message, CONTEXT);
}
