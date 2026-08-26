// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../models/common.model';
import type { CBTForce } from '../models/cbt-force.model';
import { CBTForceMember } from '../models/force-member.model';
import { asArmorFaceId, asComponentId, asCrewPositionId, asCriticalSlotId, asLocationId } from '../models/entity/entity-identifiers';
import { asStateRevision, asUnitInstanceId } from '../models/runtime/runtime-state';
import type { MekRecordSheetSnapshot } from '../models/runtime/mek-record-sheet';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { sanitizeMulFilename, serializeForceToMul } from './mul-file.util';

describe('MUL file utilities', () => {
    it('sanitizes force names for MUL filenames', () => {
        expect(sanitizeMulFilename('  A: Bad/Force*Name  ')).toBe('A-BadForceName');
        expect(sanitizeMulFilename('')).toBe('mekbay-force');
    });

    it('serializes only canonical roster members from Entity + runtime record-sheet snapshots', async () => {
        const instanceId = asUnitInstanceId('unit:mul-v2');
        const locationId = asLocationId('location:ct');
        const snapshot = {
            stateRevision: asStateRevision(4),
            identity: {
                baseChassis: 'Atlas', model: 'AS7-D', techBase: 'Inner Sphere',
                displayName: 'Atlas AS7-D', motiveType: 'Biped', cockpit: 'Standard',
                form: 'biped', massTons: 100,
            },
            movement: { motiveType: 'Biped' },
            crew: [{
                positionId: asCrewPositionId('crew:pilot'), positionKey: 'pilot', occurrence: 0,
                name: 'Morgan', role: 'Pilot', gunnery: 3, piloting: 4,
                state: { wounds: 2, unconscious: false, ejected: false },
            }],
            locations: [{
                locationId, code: 'CT', maximumInternal: 31, committedRemainingInternal: 20,
                previewRemainingInternal: 20, conditions: [],
                armor: [{
                    faceId: asArmorFaceId('armor:ct-front'), locationId, locationCode: 'CT',
                    face: 'front', maximum: 47, committedRemaining: 40, previewRemaining: 40,
                }],
            }],
            criticalSlots: [{
                slotId: asCriticalSlotId('slot:ct:0'), locationId, locationCode: 'CT', slotIndex: 0,
                armored: false, committedHits: 1, previewHits: 1,
                components: [{
                    componentId: asComponentId('component:engine'), label: 'Engine',
                    system: 'Engine', status: 'destroyed',
                }],
            }],
        } as unknown as MekRecordSheetSnapshot;
        let member!: CBTForceMember;
        const force = {
            gameSystem: GameSystem.CLASSIC,
            queryCanonicalRoster: () => ({
                kind: 'available',
                snapshot: { structural: { members: [{ instanceId, commander: true }] } },
            }),
            getClassicMember: (id: unknown) => id === instanceId ? member : null,
            getMekRecordSheetSnapshot: (id: unknown) => id === instanceId ? snapshot : null,
            getUnitSnapshot: (id: unknown) => id === instanceId ? {
                entity: {
                    entityType: 'Mek',
                    quirks: () => [{ quirk: { key: 'command-mek' } }],
                },
            } : null,
        } as unknown as CBTForce;
        member = new CBTForceMember(instanceId, force, createEmptyUnit({
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            entityType: 'Mek',
        }));

        const xml = await serializeForceToMul(force);

        expect(xml).toContain('chassis=\"Atlas\"');
        expect(xml).toContain('model=\"AS7-D\"');
        expect(xml).toContain('commander=\"true\"');
        expect(xml).toContain('name=\"Morgan\"');
        expect(xml).toContain('gunnery=\"3\"');
        expect(xml).toContain('piloting=\"4\"');
        expect(xml).toContain('hits=\"2\"');
        expect(xml).toContain('points=\"40\"');
        expect(xml).toContain('points=\"20\"');
        expect(xml).toContain('type=\"Engine\"');
        expect(xml).toContain('isDestroyed=\"true\"');
    });

    it('serializes a non-Mek from its Entity and sparse runtime instead of skipping it', async () => {
        const instanceId = asUnitInstanceId('unit:mul-tank');
        const locationId = asLocationId('location:FRONT');
        const faceId = asArmorFaceId('armor:location:FRONT:front');
        const positionId = asCrewPositionId('crew:0');
        const entitySnapshot = {
            entity: {
                entityType: 'Tank',
                motiveType: () => 'Tracked',
                techBase: () => 'IS',
                quirks: () => [],
            },
            index: {
                locations: new Map([[locationId, {
                    id: locationId,
                    code: 'FRONT',
                    internalPoints: 10,
                    armorFaceIds: [faceId],
                }]]),
                armorFaces: new Map([[faceId, {
                    id: faceId,
                    locationId,
                    face: 'front',
                    maximumPoints: 20,
                }]]),
                components: new Map(),
                crewPositions: new Map([[positionId, { id: positionId, occurrence: 0 }]]),
            },
            state: {
                explicitlyDestroyed: false,
                locations: new Map([[locationId, {
                    internalDamage: 3,
                    armorDamage: [{ faceId, damage: 5 }],
                }]]),
                components: new Map(),
                ammo: new Map(),
                crew: new Map([[positionId, { wounds: 1, unconscious: false, ejected: false }]]),
            },
            query: { destroyed: () => false },
        };
        let member!: CBTForceMember;
        const force = {
            gameSystem: GameSystem.CLASSIC,
            queryCanonicalRoster: () => ({
                kind: 'available',
                snapshot: { structural: { members: [{ instanceId, commander: false }] } },
            }),
            getClassicMember: (id: unknown) => id === instanceId ? member : null,
            getMekRecordSheetSnapshot: () => null,
            getUnitSnapshot: (id: unknown) => id === instanceId ? entitySnapshot : null,
            getUnitCrewAssignment: () => ({
                schemaVersion: 1,
                positions: [{
                    positionId,
                    name: 'Alex',
                    role: 'Driver',
                    gunnery: 4,
                    piloting: 5,
                }],
            }),
        } as unknown as CBTForce;
        member = new CBTForceMember(instanceId, force, createEmptyUnit({
            name: 'Vedette Medium Tank',
            chassis: 'Vedette',
            model: 'Medium Tank',
            entityType: 'Tank',
        }));

        const xml = await serializeForceToMul(force);

        expect(xml).toContain('chassis=\"Vedette\"');
        expect(xml).toContain('type=\"Tracked\"');
        expect(xml).toContain('name=\"Alex\"');
        expect(xml).toContain('hits=\"1\"');
        expect(xml).toContain('points=\"15\"');
        expect(xml).toContain('points=\"7\"');
    });

    it('fails closed when canonical roster authority is unavailable', async () => {
        const force = {
            gameSystem: GameSystem.CLASSIC,
            queryCanonicalRoster: () => ({ kind: 'unavailable', message: 'No canonical roster' }),
        } as unknown as CBTForce;
        await expectAsync(serializeForceToMul(force)).toBeRejectedWithError(/No canonical roster/u);
    });
});
