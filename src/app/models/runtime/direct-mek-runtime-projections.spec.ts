// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asEncounterTargetId,
    emptyCBTEncounterSnapshot,
    type TargetRegistrySnapshot,
} from './encounter-runtime';
import { TARGET_INDIRECT_WEAPON_REASON } from './mek-targeting-rules';
import {
    equipmentPanelRuntimeTarget,
    projectMekEquipmentPanel,
    projectWeaponTargetPresentation,
} from './equipment-panel';
import { projectMekRecordSheet } from './mek-record-sheet';
import { evaluateMekRuntimeCapability } from './mek-runtime-capability';
import {
    deserializeMekMovementPsrStateV2,
    MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
    serializeMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    isMekTurnPanelDirtyPhase,
    mekAttackMovementModifier,
    projectMekSpottingModifier,
    projectMekTurnPanel,
} from './mek-turn-panel';
import { asCommandId, asStateRevision } from './runtime-state';
import {
    createDirectAesRuntimeFixture,
    createDirectBoosterRuntimeFixture,
    createDirectChargeRuntimeFixture,
    createDirectClawRuntimeFixture,
    createDirectCommandConsoleRuntimeFixture,
    createDirectCompleteLegAesRuntimeFixture,
    createDirectDroneRuntimeFixture,
    createDirectEscalatingFailureRuntimeFixture,
    createDirectJetBoosterRuntimeFixture,
    createDirectLaserInsulatorRuntimeFixture,
    createDirectLegAesRuntimeFixture,
    createDirectLegDamageFloorRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectPairedAesRuntimeFixture,
    createDirectPartialWingRuntimeFixture,
    createDirectPrototypeLaserRuntimeFixture,
    createDirectQuadRuntimeFixture,
    createDirectShieldRuntimeFixture,
    createDirectSuperheavyRuntimeFixture,
    createDirectTargetingComputerRuntimeFixture,
    createDirectTripodRuntimeFixture,
    createDirectVibrobladeRuntimeFixture,
    createDirectVspRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct Mek entity/runtime projections', () => {
    it('derives torso equipment destruction and dependent-arm detachment after pending damage commits', () => {
        const fixture = createDirectMekRuntimeFixture();
        const leftTorso = [...fixture.index.locations.values()].find(location => location.code === 'LT')!;
        const leftArm = [...fixture.index.locations.values()].find(location => location.code === 'LA')!;

        expect(fixture.instance.dispatch({
            type: 'damage-internal',
            commandId: asCommandId('location-loss:pending-left-torso'),
            expectedRevision: asStateRevision(0),
            locationId: leftTorso.id,
            amount: leftTorso.internalPoints,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'commit-pending',
            commandId: asCommandId('location-loss:commit-left-torso'),
            expectedRevision: asStateRevision(1),
        }).accepted).toBeTrue();

        const query = fixture.instance.query();
        expect(query.locationStatus(leftTorso.id)).toBe('destroyed');
        expect(query.locationStatus(leftArm.id)).toBe('destroyed');
        for (const slot of fixture.index.slots.values()) {
            if (slot.locationId !== leftTorso.id && slot.locationId !== leftArm.id) continue;
            for (const componentId of slot.componentIds) {
                expect(query.componentStatusAtLocation(componentId, slot.locationId))
                    .withContext(`${fixture.index.locations.get(slot.locationId)?.code}:${componentId}`)
                    .toBe('destroyed');
            }
        }

        const sheet = projectMekRecordSheet(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.snapshot(),
            query,
            emptyCBTEncounterSnapshot(),
            null,
        );
        const torso = sheet.locations.find(location => location.locationId === leftTorso.id)!;
        const arm = sheet.locations.find(location => location.locationId === leftArm.id)!;
        expect(torso.committedStructurallyDestroyed).toBeTrue();
        expect(torso.committedDetached).toBeFalse();
        expect(arm.committedStructurallyDestroyed).toBeFalse();
        expect(arm.committedDetached).toBeTrue();
    });

    it('marks a phase dirty when Mek damage is pending commit', () => {
        const fixture = createDirectMekRuntimeFixture();
        const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 0)!;

        expect(fixture.instance.dispatch({
            type: 'damage-armor',
            commandId: asCommandId('turn-panel:pending-damage'),
            expectedRevision: asStateRevision(0),
            faceId: face.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();

        const panel = projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            'manual',
        );
        expect(panel.hasPendingCombat).toBeTrue();
        expect(isMekTurnPanelDirtyPhase(panel)).toBeTrue();
    });

    it('builds the sheet and equipment panel from entity facts plus sparse state', () => {
        const fixture = createDirectMekRuntimeFixture();
        const registry = emptyCBTEncounterSnapshot();
        const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;
        const laser = [...fixture.index.components.values()].find(component =>
            component.kind === 'equipment' && component.mount.equipmentId === 'ISMediumLaser')!;
        if (laser.kind !== 'equipment') throw new Error('Fixture laser is missing');

        expect(fixture.instance.dispatch({
            type: 'damage-armor', commandId: asCommandId('projection:armor'),
            expectedRevision: asStateRevision(0), faceId: face.id, amount: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('projection:laser'),
            expectedRevision: asStateRevision(1), componentId: laser.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();

        const query = fixture.instance.query();
        const sheet = projectMekRecordSheet(
            fixture.entity, fixture.index, fixture.instance.ruleset(),
            fixture.instance.snapshot(), query, registry, null,
        );
        const panel = projectMekEquipmentPanel(
            fixture.entity, fixture.index, fixture.instance.ruleset(), query, registry,
        );
        const sheetFace = sheet.locations.flatMap(location => location.armor)
            .find(candidate => candidate.faceId === face.id)!;
        const panelLaser = panel.components.find(component => component.componentId === laser.id)!;

        expect(sheet.entityUuid).toBe(fixture.entity.uuid());
        expect(sheetFace.committedRemaining).toBe(face.maximumPoints - 1);
        expect(panelLaser.status).toBe('destroyed');
        expect(panel.physicalAttackBlockers).toEqual([]);
        expect(panel.physicalAttacks.map(attack => attack.label)).toEqual([
            'Punch', 'Punch', 'Kick', 'Club (Club/Improvised)', 'Charge', 'Push',
        ]);
        expect(panel.physicalAttacks.map(attack => attack.hitModifiers)).toEqual([
            [-1], [-1], [-1], [-1], ['versus'], [-1],
        ]);
        expect(fixture.entity.getArmorValue(
            fixture.index.locations.get(face.locationId)!.code,
            face.face,
        )).toBe(face.maximumPoints);
    });

    it('keeps pending-destroyed Mek ammo usable until the phase commits', () => {
        const fixture = createDirectMekRuntimeFixture();
        const launcher = fixture.equipmentComponent('Test Artemis Launcher');
        const ammo = fixture.equipmentComponent('Test Artemis Ammo');
        const source = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(component => component.componentId === launcher.id)!
            .weapon!.ammoSources.find(candidate => candidate.componentId === ammo.id)!;

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            commandId: asCommandId('ammo-source:pending-destroyed'),
            expectedRevision: fixture.instance.revision(),
            componentId: ammo.id,
            status: 'destroyed',
            target: 'pending',
        }).accepted).toBeTrue();
        expect(source()).toEqual(jasmine.objectContaining({
            location: ammo.mount.location,
            status: 'available',
        }));
        expect(source().remaining).toBeGreaterThan(0);

        expect(fixture.instance.dispatch({
            type: 'commit-pending',
            commandId: asCommandId('ammo-source:commit-destroyed'),
            expectedRevision: fixture.instance.revision(),
        }).accepted).toBeTrue();
        expect(source()).toEqual(jasmine.objectContaining({
            status: 'destroyed',
            remaining: 0,
        }));
    });

    it('projects crew state and computed unit conditions from entity plus sparse runtime', () => {
        const fixture = createDirectMekRuntimeFixture();
        const pilot = [...fixture.index.crewPositions.values()]
            .find(position => position.occurrence === 0)!;

        expect(fixture.instance.dispatch({
            type: 'set-crew-state',
            commandId: asCommandId('conditions:unconscious'),
            expectedRevision: asStateRevision(0),
            positionId: pilot.id,
            wounds: 0,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();

        let query = fixture.instance.query();
        let sheet = projectMekRecordSheet(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.snapshot(),
            query,
            emptyCBTEncounterSnapshot(),
            null,
        );
        expect(query.hasCondition('immobile')).toBeTrue();
        expect(query.hasCondition('abandoned')).toBeFalse();
        expect(sheet.conditions).toContain('immobile');
        expect(sheet.crew[0]?.effectiveState).toBe('unconscious');
        expect(projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            query,
            'manual',
        )).toEqual(jasmine.objectContaining({
            canTakeActiveActions: false,
            conditions: jasmine.arrayContaining(['immobile']),
        }));

        expect(fixture.instance.dispatch({
            type: 'set-crew-state',
            commandId: asCommandId('conditions:ejected'),
            expectedRevision: asStateRevision(1),
            positionId: pilot.id,
            wounds: 0,
            unconscious: false,
            ejected: true,
        }).accepted).toBeTrue();
        query = fixture.instance.query();
        sheet = projectMekRecordSheet(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.snapshot(),
            query,
            emptyCBTEncounterSnapshot(),
            null,
        );
        expect(query.hasCondition('abandoned')).toBeTrue();
        expect(sheet.conditions).toContain('abandoned');
        expect(sheet.crew[0]?.effectiveState).toBe('ejected');
        expect(projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            query,
            'manual',
        ).canTakeActiveActions).toBeFalse();
    });

    it('derives a dead crew display from committed cockpit destruction', () => {
        const fixture = createDirectMekRuntimeFixture();
        const cockpit = [...fixture.index.components.values()].find(component =>
            component.kind === 'system' && component.systemType === 'Cockpit')!;
        const cockpitSlot = [...fixture.index.slots.values()].find(slot =>
            slot.componentIds.includes(cockpit.id))!;

        expect(fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId('conditions:cockpit-destroyed'),
            expectedRevision: asStateRevision(0),
            slotId: cockpitSlot.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();

        const query = fixture.instance.query();
        const sheet = projectMekRecordSheet(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.snapshot(),
            query,
            emptyCBTEncounterSnapshot(),
            null,
        );
        expect(sheet.crew[0]?.effectiveState).toBe('dead');
        expect(query.hasCondition('abandoned')).toBeTrue();
    });

    it('maps command-console cockpit loss to its crew and spotting behavior', () => {
        const fixture = createDirectCommandConsoleRuntimeFixture();
        const cockpit = [...fixture.index.components.values()].find(component =>
            component.kind === 'system' && component.systemType === 'Cockpit')!;
        const cockpitSlots = [...fixture.index.slots.values()]
            .filter(slot => slot.componentIds.includes(cockpit.id))
            .sort((left, right) => left.slotIndex - right.slotIndex);
        expect(cockpitSlots.length).toBe(2);
        expect(projectMekSpottingModifier(
            fixture.entity, fixture.index, fixture.instance.query(),
        )).toBe(0);

        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('command-console:main-cockpit'),
            expectedRevision: fixture.instance.revision(), slotId: cockpitSlots[0]!.id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        let query = fixture.instance.query();
        let sheet = projectMekRecordSheet(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.snapshot(),
            query, emptyCBTEncounterSnapshot(), null,
        );
        expect(sheet.crew.map(position => position.effectiveState)).toEqual(['dead', 'healthy']);
        expect(query.destroyed()).toBeFalse();
        expect(projectMekSpottingModifier(fixture.entity, fixture.index, query)).toBe(1);

        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('command-console:second-cockpit'),
            expectedRevision: fixture.instance.revision(), slotId: cockpitSlots[1]!.id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        query = fixture.instance.query();
        sheet = projectMekRecordSheet(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.snapshot(),
            query, emptyCBTEncounterSnapshot(), null,
        );
        expect(sheet.crew.map(position => position.effectiveState)).toEqual(['dead', 'dead']);
        expect(query.destroyed()).toBeTrue();
    });

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`treats a ${ruleset} drone Mek as crewless and disconnects it with its OS`, () => {
            const fixture = createDirectDroneRuntimeFixture(ruleset);
            const drone = fixture.equipmentComponent('Test Drone Operating System');
            const pilot = [...fixture.index.crewPositions.values()][0]!;
            const before = fixture.instance.query().mekMovementPsr();
            expect(before.kind).toBe('supported');
            if (before.kind !== 'supported') return;
            expect(before.permanentPsrModifiers.map(modifier => modifier.reason))
                .not.toContain('Mounts small or torso cockpit');

            expect(fixture.instance.dispatch({
                type: 'set-crew-state', commandId: asCommandId(`drone:${ruleset}:eject`),
                expectedRevision: fixture.instance.revision(), positionId: pilot.id,
                wounds: 0, unconscious: false, ejected: true,
            }).accepted).toBeTrue();
            expect(fixture.instance.query().hasCondition('abandoned')).toBeFalse();
            expect(fixture.instance.query().mekMovementPsr()).toEqual(jasmine.objectContaining({
                kind: 'supported', immobile: false,
            }));

            expect(fixture.instance.dispatch({
                type: 'set-component-status', commandId: asCommandId(`drone:${ruleset}:destroy-os`),
                expectedRevision: fixture.instance.revision(), componentId: drone.id,
                status: 'destroyed', target: 'committed',
            }).accepted).toBeTrue();
            expect(fixture.instance.query().hasCondition('disconnected')).toBeTrue();
            expect(fixture.instance.query().mekMovementPsr()).toEqual(jasmine.objectContaining({
                kind: 'supported', immobile: true,
            }));

            expect(fixture.instance.dispatch({
                type: 'set-component-status', commandId: asCommandId(`drone:${ruleset}:repair-os`),
                expectedRevision: fixture.instance.revision(), componentId: drone.id,
                status: 'available', target: 'committed',
            }).accepted).toBeTrue();
            expect(fixture.instance.query().hasCondition('disconnected')).toBeFalse();
            expect(fixture.instance.query().mekMovementPsr()).toEqual(jasmine.objectContaining({
                kind: 'supported', immobile: false,
            }));
        });
    }

    it('requires active MASC for boosted Run and retains an active failed booster for the turn', () => {
        const fixture = createDirectMekRuntimeFixture();
        const masc = fixture.equipmentComponent('Test MASC');
        const movement = () => {
            const projection = fixture.instance.query().mekMovementPsr();
            if (projection.kind !== 'supported') throw new Error('MASC movement projection is unsupported');
            return projection;
        };
        const run = () => movement().actions.find(action => action.kind === 'run')!;

        expect(movement()).toEqual(jasmine.objectContaining({ runMp: 8, maximumRunMp: 10 }));
        expect(run()).toEqual(jasmine.objectContaining({ ordinaryMaximumMp: 8, maximumMp: 10 }));
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('masc:inactive-run'),
            expectedRevision: asStateRevision(0),
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run', distance: 10, boosterComponentIds: [masc.id],
            },
        }).accepted).toBeFalse();

        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure', commandId: asCommandId('masc:activate'),
            expectedRevision: asStateRevision(0), componentId: masc.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('masc:active-run'),
            expectedRevision: asStateRevision(1),
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run', distance: 10, boosterComponentIds: [masc.id],
            },
        }).accepted).toBeTrue();

        expect(fixture.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('masc:failed'),
            expectedRevision: asStateRevision(2), componentId: masc.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        expect(movement()).toEqual(jasmine.objectContaining({ runMp: 8, maximumRunMp: 8 }));
        expect(run()).toEqual(jasmine.objectContaining({ ordinaryMaximumMp: 8, maximumMp: 10 }));
        expect(movement().declaration).toEqual(jasmine.objectContaining({ legal: true, maximumMp: 10 }));
    });

    it('suppresses an active but disabled MASC in both movement and overlay command facts', () => {
        const fixture = createDirectMekRuntimeFixture();
        const masc = fixture.equipmentComponent('Test MASC');
        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure', commandId: asCommandId('masc:disabled:activate'),
            expectedRevision: asStateRevision(0), componentId: masc.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('masc:disabled:set'),
            expectedRevision: asStateRevision(1), componentId: masc.id,
            status: 'disabled', target: 'committed',
        }).accepted).toBeTrue();

        const query = fixture.instance.query();
        const movement = query.mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(movement).toEqual(jasmine.objectContaining({ runMp: 8, maximumRunMp: 8 }));
        expect(movement.actions.find(action => action.kind === 'run')?.maximumMp).toBe(8);
        expect(projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            query,
            'manual',
        ).activeBoosterComponentIds).toEqual([]);
    });

    it('stacks only the active MASC and Supercharger selected by the Run declaration', () => {
        const fixture = createDirectBoosterRuntimeFixture();
        const masc = fixture.equipmentComponent('Test MASC');
        const supercharger = fixture.equipmentComponent('Test Supercharger');
        const movement = () => {
            const projection = fixture.instance.query().mekMovementPsr();
            if (projection.kind !== 'supported') throw new Error('Booster movement projection is unsupported');
            return projection;
        };

        expect(movement()).toEqual(jasmine.objectContaining({ runMp: 8, maximumRunMp: 13 }));
        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure', commandId: asCommandId('booster:supercharger'),
            expectedRevision: asStateRevision(0), componentId: supercharger.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('booster:supercharger-run'),
            expectedRevision: asStateRevision(1),
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run', distance: 10, boosterComponentIds: [supercharger.id],
            },
        }).accepted).toBeTrue();
        expect(movement().declaration?.maximumMp).toBe(10);

        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure', commandId: asCommandId('booster:masc'),
            expectedRevision: asStateRevision(2), componentId: masc.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('booster:stacked-run'),
            expectedRevision: asStateRevision(3),
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run', distance: 13, boosterComponentIds: [masc.id, supercharger.id],
            },
        }).accepted).toBeTrue();
        expect(movement().declaration).toEqual(jasmine.objectContaining({ legal: true, maximumMp: 13 }));
    });

    it('wires only active MASC-family components into the turn-panel Run command', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture();
        const masc = fixture.equipmentComponent('Test MASC');
        const viral = fixture.equipmentComponent('Test RISC Viral Jammer');
        for (const [index, component] of [masc, viral].entries()) {
            expect(fixture.instance.dispatch({
                type: 'edit-escalating-failure', commandId: asCommandId(`turn-panel:active:${index}`),
                expectedRevision: asStateRevision(index), componentId: component.id,
                edit: { kind: 'select-sequence', index: 0 },
            }).accepted).toBeTrue();
        }

        const panel = projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            'manual',
        );
        expect(panel.activeBoosterComponentIds).toEqual([masc.id]);
    });

    it('uses an active Jet Booster only while airborne', () => {
        const fixture = createDirectJetBoosterRuntimeFixture();
        const jetBooster = fixture.equipmentComponent('Test Jet Booster');
        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure', commandId: asCommandId('jet-booster:grounded-activate'),
            expectedRevision: asStateRevision(0), componentId: jetBooster.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeFalse();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('jet-booster:airborne'),
            expectedRevision: asStateRevision(0),
            turn: { ...fixture.instance.query().turnState(), airborne: true },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure', commandId: asCommandId('jet-booster:activate'),
            expectedRevision: asStateRevision(1), componentId: jetBooster.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            'manual',
        ).activeBoosterComponentIds).toEqual([jetBooster.id]);
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('jet-booster:run'),
            expectedRevision: asStateRevision(2),
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run', distance: 10, boosterComponentIds: [jetBooster.id],
            },
        }).accepted).toBeTrue();

        expect(fixture.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('jet-booster:grounded'),
            expectedRevision: asStateRevision(3),
            turn: { ...fixture.instance.query().turnState(), airborne: null },
        }).accepted).toBeTrue();
        const query = fixture.instance.query();
        expect(query.componentEscalatingFailure(jetBooster.id)?.active).toBeTrue();
        expect(projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            query,
            'manual',
        ).activeBoosterComponentIds).toEqual([]);
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('jet-booster:grounded-run'),
            expectedRevision: asStateRevision(4),
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run', distance: 10, boosterComponentIds: [jetBooster.id],
            },
        }).accepted).toBeFalse();
    });

    it('ports Core and Total Warfare charge damage through entity construction plus sparse state', () => {
        const effect = (fixture: ReturnType<typeof createDirectChargeRuntimeFixture>) => {
            const panel = projectMekEquipmentPanel(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                emptyCBTEncounterSnapshot(),
            );
            const charge = panel.physicalAttacks.find(attack => attack.label === 'Charge');
            if (charge?.effect.kind !== 'damage') throw new Error('Charge damage is missing');
            return charge.effect;
        };

        const core = createDirectChargeRuntimeFixture('core-2026', 'unit:core-charge');
        expect(effect(core)).toEqual(jasmine.objectContaining({
            damage: 16,
            maximumDamage: 56,
            baseDamage: 14,
            displayFormula: '13.5×(TMM+1)+2',
            weakened: false,
        }));
        expect(core.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('charge:core:walk'),
            expectedRevision: asStateRevision(0),
            declaration: { schemaVersion: 1, mode: 'walk', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(effect(core)).toEqual(jasmine.objectContaining({
            damage: 43,
            maximumDamage: 56,
            baseDamage: 41,
            weakened: false,
        }));
        expect(effect(core).displayFormula).toBeUndefined();

        const ramPlate = core.equipmentComponent('Test Ram Plate');
        expect(core.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('charge:core:ram-plate'),
            expectedRevision: asStateRevision(1), componentId: ramPlate.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        expect(effect(core)).toEqual(jasmine.objectContaining({
            damage: 29,
            maximumDamage: 56,
            baseDamage: 27,
            weakened: true,
        }));

        const tw = createDirectChargeRuntimeFixture('total-warfare', 'unit:tw-charge');
        expect(effect(tw)).toEqual(jasmine.objectContaining({
            damage: 2,
            maximumDamage: 50,
            baseDamage: 0,
            displayFormula: '6.75/hex+2',
            weakened: false,
        }));
        expect(tw.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('charge:tw:walk'),
            expectedRevision: asStateRevision(0),
            declaration: { schemaVersion: 1, mode: 'walk', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(effect(tw)).toEqual(jasmine.objectContaining({
            damage: 29,
            maximumDamage: 50,
            baseDamage: 27,
            weakened: false,
        }));

        const flooded = createDirectChargeRuntimeFixture('core-2026', 'unit:flooded-spikes');
        const leftLeg = [...flooded.index.locations.values()].find(location => location.code === 'LL')!;
        expect(flooded.instance.dispatch({
            type: 'set-location-condition', commandId: asCommandId('charge:spikes:flooded'),
            expectedRevision: asStateRevision(0), locationId: leftLeg.id,
            condition: 'flooded', value: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(effect(flooded).displayFormula).toBe('13.5×(TMM+1)+2');
    });

    it('halves Claw damage for each destroyed arm actuator before applying TSM', () => {
        const fixture = createDirectClawRuntimeFixture('core-2026');
        const claw = fixture.equipmentComponent('Test Claw');
        const effect = () => {
            const panel = projectMekEquipmentPanel(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                emptyCBTEncounterSnapshot(),
            );
            const row = panel.physicalAttacks.find(attack =>
                attack.target.kind === 'component' && attack.target.componentId === claw.id);
            if (row?.effect.kind !== 'damage') throw new Error('Claw damage is missing');
            return row.effect;
        };
        const actuator = (systemType: string) => [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'RA'
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === systemType;
            }))!;

        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 8, maximumDamage: 16, baseDamage: 8, weakened: false,
        }));
        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('claw:upper-arm'),
            expectedRevision: asStateRevision(0), slotId: actuator('Upper Arm Actuator').id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 4, maximumDamage: 8, baseDamage: 4, weakened: true,
        }));
        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('claw:lower-arm'),
            expectedRevision: asStateRevision(1), slotId: actuator('Lower Arm Actuator').id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 2, maximumDamage: 4, baseDamage: 2, weakened: true,
        }));
        expect(fixture.instance.dispatch({
            type: 'set-heat', commandId: asCommandId('claw:tsm'),
            expectedRevision: asStateRevision(2), heat: 9,
        }).accepted).toBeTrue();
        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 4, maximumDamage: 4, baseDamage: 2, weakened: true, boosted: true,
        }));
    });

    it('ports paired-arm and complete-leg AES physical modifiers from parsed installations', () => {
        const panel = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>) =>
            projectMekEquipmentPanel(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                emptyCBTEncounterSnapshot(),
            );
        const aesAt = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>, location: string) => {
            const component = [...fixture.index.components.values()].find(candidate =>
                candidate.kind === 'equipment'
                && candidate.mount.equipmentId === 'Test AES'
                && candidate.mount.getOccupiedLocations().includes(location));
            if (!component || component.kind !== 'equipment') throw new Error(`Missing ${location} AES`);
            return component;
        };

        const arms = createDirectPairedAesRuntimeFixture('core-2026');
        const armRows = () => panel(arms).physicalAttacks;
        const action = (rows: ReturnType<typeof armRows>, label: string) => {
            const row = rows.find(candidate => candidate.label === label);
            if (!row) throw new Error(`Missing ${label}`);
            return row;
        };
        expect(action(armRows(), 'Club (Club/Improvised)').hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Paired Arm AES', modifier: -1,
        }));
        expect(action(armRows(), 'Push').hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Paired Arm AES', modifier: -1,
        }));
        expect(arms.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('aes:paired:left'),
            expectedRevision: asStateRevision(0), componentId: aesAt(arms, 'LA').id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        expect(action(armRows(), 'Club (Club/Improvised)').hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Arm AES (RA)', modifier: -1,
        }));
        expect(action(armRows(), 'Push').hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Arm AES Destroyed', modifier: 0, weakened: true,
        }));

        const legs = createDirectCompleteLegAesRuntimeFixture('core-2026');
        const kick = () => panel(legs).physicalAttacks.find(candidate => candidate.label === 'Kick')!;
        expect(kick().hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Leg AES', modifier: -1,
        }));
        expect(legs.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('aes:legs:left'),
            expectedRevision: asStateRevision(0), componentId: aesAt(legs, 'LL').id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        expect(kick().hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Leg AES Destroyed', modifier: 0, weakened: true,
        }));

        const partial = createDirectLegAesRuntimeFixture('core-2026', 'unit:partial-leg-aes');
        const partialKick = panel(partial).physicalAttacks.find(candidate => candidate.label === 'Kick')!;
        expect(partialKick.hitModifierBreakdown.some(entry => entry.label.includes('Leg AES'))).toBeFalse();
    });

    it('shows Vibroblade alternate damage and excludes active blades from TSM', () => {
        const fixture = createDirectVibrobladeRuntimeFixture('core-2026');
        const vibroblade = fixture.equipmentComponent('Test Small Vibroblade');
        const initialRows = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).physicalAttacks;
        expect(initialRows[0].target).toEqual({
            kind: 'component',
            componentId: vibroblade.id,
        });
        expect(initialRows.filter(row => row.target.kind === 'intrinsic').map(row => row.label)).toEqual([
            'Punch',
            'Punch',
            'Kick',
            'Club (Club/Improvised)',
            'Charge',
            'Push',
        ]);
        const effect = () => {
            const panel = projectMekEquipmentPanel(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                emptyCBTEncounterSnapshot(),
            );
            const row = panel.physicalAttacks.find(attack =>
                attack.target.kind === 'component' && attack.target.componentId === vibroblade.id);
            if (row?.effect.kind !== 'damage') throw new Error('Vibroblade damage is missing');
            return row.effect;
        };

        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 7, maximumDamage: 14, alternateDamage: 7, boosted: false,
        }));
        let heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.some(source =>
            source.id === `vibroblade:${vibroblade.id}`)).toBeFalse();
        expect(fixture.instance.dispatch({
            type: 'set-heat', commandId: asCommandId('vibroblade:tsm'),
            expectedRevision: asStateRevision(0), heat: 9,
        }).accepted).toBeTrue();
        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 14, maximumDamage: 14, alternateDamage: 7, boosted: true,
        }));
        expect(fixture.instance.dispatch({
            type: 'set-component-mode', commandId: asCommandId('vibroblade:on'),
            expectedRevision: asStateRevision(1), componentId: vibroblade.id, mode: 'ON',
        }).accepted).toBeTrue();
        expect(effect()).toEqual(jasmine.objectContaining({
            damage: 7, maximumDamage: 7, boosted: false,
        }));
        expect(effect().alternateDamage).toBeUndefined();
        heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.find(source =>
            source.id === `vibroblade:${vibroblade.id}`)?.value).toBe(3);

        expect(fixture.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('vibroblade:destroyed'),
            expectedRevision: asStateRevision(2), componentId: vibroblade.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.find(source =>
            source.id === `vibroblade:${vibroblade.id}`)?.value).toBe(3);
    });

    it('projects turn state and admits the parsed entity as a whole unit', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const panel = projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            'manual',
        );

        expect(evaluateMekRuntimeCapability(fixture.entity)).toEqual({
            readiness: 'ready', family: 'mek', v2Coverage: 'whole-unit',
        });
        expect(panel.entityUuid).toBe(fixture.entity.uuid());
        expect(panel.stateRevision).toBe(asStateRevision(0));
        expect(panel.movement.kind).toBe('supported');
        expect(panel.heatProjection.kind).toBe('supported');
        const leftLeg = [...fixture.index.locations.values()].find(location => location.code === 'LL')!;
        expect(panel.locationLabels[leftLeg.id]).toBe('Left Leg');
    });

    it('projects production movement labels and defender modifiers outside the overlay UI', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('turn-rules:walk'),
            expectedRevision: asStateRevision(0),
            declaration: { schemaVersion: 1, mode: 'walk', distance: 3, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('turn-rules:skidding'),
            expectedRevision: asStateRevision(1), condition: 'skidding', active: true,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('turn-rules:prone'),
            expectedRevision: asStateRevision(2), condition: 'prone', active: true,
        }).accepted).toBeTrue();
        const turn = fixture.instance.query().turnState();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('turn-rules:cover'),
            expectedRevision: asStateRevision(3), turn: { ...turn, cover: 'light' },
        }).accepted).toBeTrue();

        const panel = projectMekTurnPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            'manual',
        );
        expect(panel.attackMovementModifiers).toEqual({
            stationary: 0, walk: 1, run: 2, sprint: 0, jump: 3, UMU: 3,
        });
        expect(panel.defenseModifierBreakdown).toEqual([
            { label: 'Skidding', modifier: 2 },
            { label: 'Moved 3-4 hexes', modifier: 1 },
            {
                label: 'Prone', modifier: 1,
                alternateModifier: -2, alternateModifierLabel: 'adjacent',
            },
        ]);
        expect(panel.defenseModifierTotal).toEqual({ modifier: 4, alternateModifier: 1 });
        expect(panel.spottingModifier).toBe(1);
    });

    it('uses the production airborne LAM attack movement modifiers', () => {
        const lam = { chassisConfig: 'LAM' } as unknown as Parameters<typeof mekAttackMovementModifier>[0];
        expect(mekAttackMovementModifier(lam, 'walk', true)).toBe(3);
        expect(mekAttackMovementModifier(lam, 'run', true)).toBe(4);
        expect(mekAttackMovementModifier(lam, 'walk', false)).toBe(1);
    });

    it('composes ruleset bases with sparse Spotting and Skidding attack modifiers once', () => {
        const tw = createDirectMekRuntimeFixture('total-warfare');
        expect(tw.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('attack-rules:tw:skidding'),
            expectedRevision: asStateRevision(0), condition: 'skidding', active: true,
        }).accepted).toBeTrue();
        expect(tw.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('attack-rules:tw:spotting'),
            expectedRevision: asStateRevision(1),
            turn: { ...tw.instance.query().turnState(), spotting: true },
        }).accepted).toBeTrue();
        const twPanel = projectMekEquipmentPanel(
            tw.entity, tw.index, tw.instance.ruleset(), tw.instance.query(), emptyCBTEncounterSnapshot(),
        );
        const twLaser = twPanel.components.find(component => component.label === 'Medium Laser')!;
        expect(twLaser.weapon?.toHitModifier).toBe(2);
        expect(twLaser.weapon?.hitModifierBreakdown).toEqual([
            { label: 'Skidding', modifier: 1 },
            { label: 'Spotting', modifier: 1 },
        ]);
        expect(twPanel.physicalAttacks.map(attack => attack.hitModifiers)).toEqual([
            [2], [2], [0], [1], ['versus', 2], [1],
        ]);

        const core = createDirectMekRuntimeFixture('core-2026');
        expect(core.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('attack-rules:core:skidding'),
            expectedRevision: asStateRevision(0), condition: 'skidding', active: true,
        }).accepted).toBeTrue();
        expect(core.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('attack-rules:core:spotting'),
            expectedRevision: asStateRevision(1),
            turn: { ...core.instance.query().turnState(), spotting: true },
        }).accepted).toBeTrue();
        const corePanel = projectMekEquipmentPanel(
            core.entity, core.index, core.instance.ruleset(), core.instance.query(), emptyCBTEncounterSnapshot(),
        );
        const coreLaser = corePanel.components.find(component => component.label === 'Medium Laser')!;
        expect(coreLaser.weapon?.toHitModifier).toBe(1);
        expect(coreLaser.weapon?.hitModifierBreakdown).toEqual([{ label: 'Spotting', modifier: 1 }]);
        expect(corePanel.physicalAttacks.map(attack => attack.hitModifiers)).toEqual([
            [0], [0], [0], [0], ['versus', 1], [0],
        ]);
    });

    it('ports Mek heat, sensor, prone, and arm-actuator attack modifiers to direct V2 state', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026');
        const slot = (systemType: string, locationCode: string) =>
            [...fixture.index.slots.values()].find(candidate => {
                const location = fixture.index.locations.get(candidate.locationId);
                return location?.code === locationCode && candidate.componentIds.some(componentId => {
                    const component = fixture.index.components.get(componentId);
                    return component?.kind === 'system' && component.systemType === systemType;
                });
            })!;

        expect(fixture.instance.dispatch({
            type: 'set-heat', commandId: asCommandId('combat-modifiers:heat'),
            expectedRevision: asStateRevision(0), heat: 13,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('combat-modifiers:prone'),
            expectedRevision: asStateRevision(1), condition: 'prone', active: true,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('combat-modifiers:sensor'),
            expectedRevision: asStateRevision(2), slotId: slot('Sensors', 'HD').id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('combat-modifiers:upper-arm'),
            expectedRevision: asStateRevision(3), slotId: slot('Upper Arm Actuator', 'LA').id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();

        const panel = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        const laser = panel.components.find(component => component.label === 'Medium Laser')!;
        expect(laser.weapon?.toHitModifier).toBe(7);
        expect(laser.weapon?.hitModifierBreakdown).toEqual([
            { label: 'Prone', modifier: 2, weakened: true },
            { label: 'Heat - Fire Modifier', modifier: 2, weakened: true, kind: 'heat' },
            { label: 'Sensors Destroyed', modifier: 2, weakened: true },
            { label: 'Upper Arm Actuator Destroyed (LA)', modifier: 1, weakened: true },
        ]);
        const leftPunch = panel.physicalAttacks.find(attack =>
            attack.target.kind === 'intrinsic' && attack.locationCodes.includes('LA'))!;
        expect(leftPunch.hitModifiers).toEqual([1]);
        expect(leftPunch.hitModifierBreakdown).toEqual([
            { label: 'Base Hit Modifier', modifier: -1 },
            { label: 'Upper Arm Actuator Destroyed (LA)', modifier: 2, weakened: true },
        ]);
    });

    it('keeps the Total Warfare lower-arm fire penalty ruleset-specific', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const lowerArm = [...fixture.index.slots.values()].find(candidate =>
            fixture.index.locations.get(candidate.locationId)?.code === 'LA'
            && candidate.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Lower Arm Actuator';
            }))!;
        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('combat-modifiers:tw-lower-arm'),
            expectedRevision: asStateRevision(0), slotId: lowerArm.id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();

        const panel = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        const laser = panel.components.find(component => component.label === 'Medium Laser')!;
        expect(laser.weapon?.toHitModifier).toBe(1);
        expect(laser.weapon?.hitModifierBreakdown).toEqual([
            { label: 'Lower Arm Actuator Destroyed (LA)', modifier: 1, weakened: true },
        ]);
        const leftPunch = panel.physicalAttacks.find(attack =>
            attack.target.kind === 'intrinsic' && attack.locationCodes.includes('LA'))!;
        expect(leftPunch.hitModifiers).toEqual([2]);
        expect(leftPunch.hitModifierBreakdown).toEqual([
            { label: 'Lower Arm Actuator Destroyed (LA)', modifier: 2, weakened: true },
        ]);
    });

    it('removes a destroyed arm AES bonus without retaining the pristine adjustment', () => {
        const fixture = createDirectAesRuntimeFixture('core-2026');
        const aes = fixture.equipmentComponent('Test AES');
        const panel = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        const rightPunch = () => panel().physicalAttacks.find(attack =>
            attack.target.kind === 'intrinsic' && attack.locationCodes.includes('RA'))!;
        const rightLaser = () => panel().components.find(component =>
            component.label === 'Medium Laser'
            && component.locations.some(location => location.code === 'RA'))!;

        expect(rightPunch().hitModifiers).toEqual([-2]);
        expect(rightPunch().hitModifierBreakdown).toEqual([
            { label: 'Base Hit Modifier', modifier: -1 },
            { label: 'Arm AES (RA)', modifier: -1 },
        ]);
        expect(rightLaser().weapon?.toHitModifier).toBe(-1);
        expect(rightLaser().weapon?.hitModifierBreakdown).toEqual([
            { label: 'Arm AES (RA)', modifier: -1 },
        ]);

        expect(fixture.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('combat-modifiers:aes-destroyed'),
            expectedRevision: asStateRevision(0), componentId: aes.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();

        expect(rightPunch().hitModifiers).toEqual([-1]);
        expect(rightPunch().hitModifierBreakdown).toEqual([
            { label: 'Base Hit Modifier', modifier: -1 },
            { label: 'Arm AES Destroyed (RA)', modifier: 0, weakened: true },
        ]);
        expect(rightLaser().weapon?.toHitModifier).toBe(0);
        expect(rightLaser().weapon?.hitModifierBreakdown).toEqual([
            { label: 'Arm AES Destroyed (RA)', modifier: 0, weakened: true },
        ]);
    });

    it('ports tripod dedicated crew modifiers through sparse crew state', () => {
        const fixture = createDirectTripodRuntimeFixture('core-2026');
        const positions = [...fixture.index.crewPositions.values()];
        const pilot = positions.find(position => position.occurrence === 0)!;
        const gunneryOfficer = positions.find(position => position.occurrence === 1)!;
        const panel = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );

        expect(panel().components.find(row => row.label === 'Medium Laser')?.weapon?.toHitModifier).toBe(0);
        expect(panel().physicalAttacks.find(attack => attack.label === 'Punch')?.hitModifiers).toEqual([-2]);
        expect(panel().physicalAttacks.find(attack => attack.label === 'Punch')?.hitModifierBreakdown).toEqual([
            { label: 'Base Hit Modifier', modifier: -1 },
            { label: 'Dedicated Pilot', modifier: -1 },
        ]);
        let movement = fixture.instance.query().mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(movement.permanentPsrModifier).toBe(-2);
        expect(movement.permanentPsrModifiers).toEqual([
            { modifier: -1, reason: 'Dedicated Pilot' },
            { modifier: -1, reason: 'No Destroyed Legs' },
        ]);

        expect(fixture.instance.dispatch({
            type: 'set-crew-state', commandId: asCommandId('combat-modifiers:dgo-disabled'),
            expectedRevision: asStateRevision(0), positionId: gunneryOfficer.id,
            wounds: 0, unconscious: true, ejected: false,
        }).accepted).toBeTrue();
        expect(panel().components.find(row => row.label === 'Medium Laser')?.weapon?.hitModifierBreakdown).toEqual([
            { label: 'Dedicated Gunnery Officer disabled', modifier: 2, weakened: true },
        ]);

        expect(fixture.instance.dispatch({
            type: 'set-crew-state', commandId: asCommandId('combat-modifiers:pilot-disabled'),
            expectedRevision: asStateRevision(1), positionId: pilot.id,
            wounds: 0, unconscious: true, ejected: false,
        }).accepted).toBeTrue();
        expect(panel().physicalAttacks.find(attack => attack.label === 'Punch')?.hitModifiers).toEqual([1]);
        expect(panel().physicalAttacks.find(attack => attack.label === 'Punch')?.hitModifierBreakdown).toEqual([
            { label: 'Base Hit Modifier', modifier: -1 },
            { label: 'Dedicated Pilot disabled', modifier: 2, weakened: true },
        ]);
        movement = fixture.instance.query().mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(movement.permanentPsrModifier).toBe(1);
        expect(movement.permanentPsrModifiers).toEqual([
            { modifier: -1, reason: 'No Destroyed Legs' },
            { modifier: 2, reason: 'Dedicated Pilot disabled' },
        ]);
    });

    it('applies the production leg-AES PSR bonus while its entity component is functional', () => {
        const fixture = createDirectLegAesRuntimeFixture('core-2026');
        const aes = fixture.equipmentComponent('Test AES');
        let movement = fixture.instance.query().mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(movement.permanentPsrModifier).toBe(-2);
        expect(movement.permanentPsrModifiers).toEqual([
            { modifier: -2, reason: 'Mounts AES in its legs' },
        ]);

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            commandId: asCommandId('leg-aes:destroyed'),
            expectedRevision: fixture.instance.query().stateRevision,
            componentId: aes.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        movement = fixture.instance.query().mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(movement.permanentPsrModifier).toBe(0);
        expect(movement.permanentPsrModifiers).toEqual([]);
    });

    it('applies the production superheavy physical modifier from entity mass', () => {
        const fixture = createDirectSuperheavyRuntimeFixture('core-2026');
        const panel = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        const punch = panel.physicalAttacks.find(attack => attack.label === 'Punch')!;
        expect(punch.hitModifiers).toEqual([0]);
        expect(punch.hitModifierBreakdown).toEqual([
            { label: 'Base Hit Modifier', modifier: -1 },
            { label: 'Superheavy', modifier: 1 },
        ]);
    });

    it('projects rapid-fire mode labels and total firing heat from the entity modes', () => {
        const fixture = createDirectMekRuntimeFixture();
        const ac = fixture.equipmentComponent('Test AC');
        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId('projection:rapid-fire'),
            expectedRevision: asStateRevision(0),
            componentId: ac.id,
            mode: 'Rapid',
        }).accepted).toBeTrue();

        const panel = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        const row = panel.components.find(component => component.componentId === ac.id)!;
        expect(row.label).toBe('Test AC (Rapid)');
        expect(row.weapon?.heat).toBe(1);
        expect(row.weapon?.firingHeat).toBe(2);
    });

    it('marks ground prototype-laser heat as variable without pre-adding its die roll', () => {
        const fixture = createDirectPrototypeLaserRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumPulseLaserPrototype');
        const row = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(component => component.componentId === laser.id)!;

        expect(row.weapon).toEqual(jasmine.objectContaining({
            heat: 4,
            firingHeat: 4,
            heatSuffix: '*',
        }));
    });

    it('applies targeting-computer status and HAG mode from entity plus sparse runtime state', () => {
        const fixture = createDirectTargetingComputerRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const hag = fixture.equipmentComponent('Test HAG');
        const targetingComputer = fixture.equipmentComponent('IS Targeting Computer');
        const panel = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );

        expect(panel().components.find(row => row.componentId === laser.id)?.weapon).toEqual(
            jasmine.objectContaining({
                toHitModifier: -1,
                hitModifierBreakdown: [{ label: 'Targeting Computer', modifier: -1 }],
            }),
        );
        expect(panel().components.find(row => row.componentId === hag.id)?.weapon?.toHitModifier).toBe(-1);

        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId('projection:targeting-computer:hag-flak'),
            expectedRevision: asStateRevision(0),
            componentId: hag.id,
            mode: 'Flak',
        }).accepted).toBeTrue();
        const flak = panel().components.find(row => row.componentId === hag.id)?.weapon;
        expect(flak?.toHitModifier).toBe(-1);
        expect(flak?.hitModifierBreakdown).toEqual([{ label: 'Test HAG (FLAK)', modifier: -1 }]);

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            commandId: asCommandId('projection:targeting-computer:destroyed'),
            expectedRevision: asStateRevision(1),
            componentId: targetingComputer.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(panel().components.find(row => row.componentId === laser.id)?.weapon).toEqual(
            jasmine.objectContaining({
                toHitModifier: 0,
                hitModifierBreakdown: [{
                    label: 'Targeting Computer Destroyed',
                    modifier: 0,
                    weakened: true,
                }],
            }),
        );
    });

    it('applies and removes the targeting-computer modifier at every VSP range', () => {
        const fixture = createDirectVspRuntimeFixture();
        const laser = fixture.equipmentComponent('Test Medium VSP Laser');
        const targetingComputer = fixture.equipmentComponent('IS Targeting Computer');
        const row = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(component => component.componentId === laser.id)!;

        expect(row().weapon?.toHitModifier).toEqual([-4, -3, -2]);
        expect(fixture.instance.dispatch({
            type: 'set-component-status', commandId: asCommandId('vsp:destroy-targeting-computer'),
            expectedRevision: fixture.instance.revision(), componentId: targetingComputer.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        const projected = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        expect(projected.components.find(component => component.componentId === targetingComputer.id)?.status)
            .toBe('destroyed');
        expect(row().status).toBe('available');
        expect(row().weapon?.effectiveWeaponTypes).toContain('P');
        expect(row().weapon).toEqual(jasmine.objectContaining({
            toHitModifier: [-3, -2, -1],
            hitModifierBreakdown: [{
                label: 'Targeting Computer Destroyed', modifier: 0, weakened: true,
            }],
        }));
    });

    it('projects the same direct V2 target restriction enforced by commands', () => {
        const fixture = createDirectMekRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const targetId = asEncounterTargetId('target:indirect');
        const registry: TargetRegistrySnapshot = Object.freeze({
            revision: asStateRevision(0),
            targets: Object.freeze([Object.freeze({
                id: targetId,
                letter: 'A',
                name: 'Indirect target',
                color: '#123456',
                unitType: 'mek-biped' as const,
            })]),
        });
        expect(fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            commandId: asCommandId('projection:indirect-facts'),
            expectedRevision: asStateRevision(0),
            expectedRegistryRevision: registry.revision,
            edit: {
                kind: 'set-target-facts',
                targetId,
                facts: { calculator: { indirectFire: true } },
            },
        }, registry, false).accepted).toBeTrue();

        const panel = projectMekEquipmentPanel(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.query(), registry,
        );
        const row = panel.components.find(component => component.componentId === laser.id)!;
        expect(row.weapon?.disabledTargetReasons[targetId]).toBe(TARGET_INDIRECT_WEAPON_REASON);
    });

    it('applies Artemis V from the linked entity component and sparse runtime state', () => {
        const fixture = createDirectMekRuntimeFixture();
        const launcher = fixture.equipmentComponent('Test Artemis Launcher');
        const artemis = fixture.equipmentComponent('Test Artemis V');
        const row = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(component => component.componentId === launcher.id)!;

        expect(row().weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Test Artemis V',
            modifier: -1,
            weakened: false,
        }));

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            commandId: asCommandId('artemis-v:disable'),
            expectedRevision: fixture.instance.snapshot().stateRevision,
            componentId: artemis.id,
            status: 'disabled',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(row().weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Test Artemis V Disabled',
            modifier: 0,
            weakened: true,
        }));
    });

    it('suppresses Artemis V while stealth ECM is active and for indirect fire', () => {
        const fixture = createDirectMekRuntimeFixture();
        const launcher = fixture.equipmentComponent('Test Artemis Launcher');
        const stealth = fixture.equipmentComponent('Test Stealth');
        expect(fixture.instance.dispatch({
            type: 'set-stealth-state',
            commandId: asCommandId('artemis-v:enable-stealth'),
            expectedRevision: fixture.instance.revision(),
            componentId: stealth.id,
            state: 'enabling',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',
            commandId: asCommandId('artemis-v:settle-stealth'),
            expectedRevision: fixture.instance.revision(),
            policy: 'automatic',
        }).accepted).toBeTrue();

        const stealthPanel = projectMekEquipmentPanel(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        expect(stealthPanel.components.find(component => component.componentId === launcher.id)
            ?.weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
                label: 'Stealth ECM', modifier: 0, weakened: true,
            }));

        const ordinary = createDirectMekRuntimeFixture();
        const ordinaryLauncher = ordinary.equipmentComponent('Test Artemis Launcher');
        const targetId = asEncounterTargetId('target:artemis-indirect');
        const registry: TargetRegistrySnapshot = Object.freeze({
            revision: asStateRevision(0),
            targets: Object.freeze([Object.freeze({
                id: targetId,
                letter: 'A',
                name: 'Indirect target',
                color: '#123456',
            })]),
        });
        expect(ordinary.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            commandId: asCommandId('artemis-v:indirect-target'),
            expectedRevision: ordinary.instance.revision(),
            expectedRegistryRevision: registry.revision,
            edit: {
                kind: 'set-target-facts',
                targetId,
                facts: { calculator: { indirectFire: true } },
            },
        }, registry, false).accepted).toBeTrue();
        const panel = projectMekEquipmentPanel(
            ordinary.entity, ordinary.index, ordinary.instance.ruleset(), ordinary.instance.query(), registry,
        );
        const row = panel.components.find(component => component.componentId === ordinaryLauncher.id)!;
        const target = equipmentPanelRuntimeTarget(panel.targets[0]!, panel.ruleset);
        expect(projectWeaponTargetPresentation(
            row, target, panel.crew.gunnery, null, panel.ruleset,
        ).weaponToHitModifier).toBe(0);
    });

    it('applies a functional Laser Insulator once and removes the benefit when disabled', () => {
        const fixture = createDirectLaserInsulatorRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const insulator = fixture.equipmentComponent('Test Laser Insulator');
        const row = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(component => component.componentId === laser.id)!;

        expect(row().weapon?.heat).toBe(2);
        expect(row().weapon?.firingHeat).toBe(2);
        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            commandId: asCommandId('laser-insulator:disable'),
            expectedRevision: fixture.instance.revision(),
            componentId: insulator.id,
            status: 'disabled',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(row().weapon?.heat).toBe(3);
        expect(row().weapon?.firingHeat).toBe(3);
    });

    it('applies Total Warfare semi-guided target movement through the direct V2 projection', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const launcher = fixture.equipmentComponent('Test Artemis Launcher');
        const ammo = fixture.equipmentComponent('Test Artemis Ammo');
        const targetId = asEncounterTargetId('target:tagged');
        const registry: TargetRegistrySnapshot = Object.freeze({
            revision: asStateRevision(0),
            targets: Object.freeze([Object.freeze({
                id: targetId,
                letter: 'A',
                name: 'Tagged target',
                color: '#123456',
                unitType: 'mek-biped' as const,
                tnCalculator: Object.freeze({ targetMovementBracket: '7-9' as const, tagged: true }),
            })]),
        });
        const munitionKey = fixture.instance.query().ammoLoadout(ammo.id).munitionKey;
        expect(fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            commandId: asCommandId('projection:semi-guided-ammo'),
            expectedRevision: asStateRevision(0),
            expectedRegistryRevision: registry.revision,
            edit: {
                kind: 'set-component-ammo',
                componentId: launcher.id,
                ammo: { munitionKey, preferredSourceId: ammo.id },
            },
        }, registry, false).accepted).toBeTrue();
        expect(fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            commandId: asCommandId('projection:semi-guided-target'),
            expectedRevision: asStateRevision(1),
            expectedRegistryRevision: registry.revision,
            edit: { kind: 'set-target-facts', targetId, facts: { distance: 3 } },
        }, registry, false).accepted).toBeTrue();

        const panel = projectMekEquipmentPanel(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.query(), registry,
        );
        const row = panel.components.find(component => component.componentId === launcher.id)!;
        const target = equipmentPanelRuntimeTarget(panel.targets[0], panel.ruleset);
        expect(target.tnModifier).toBe(3);
        expect(projectWeaponTargetPresentation(
            row, target, panel.crew.gunnery, null, panel.ruleset,
        ).targetModifier).toBe(0);
    });

    it('owns Core standing attempts, spent MP, failure, and heat in sparse V2 state', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026');

        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('standing:core:prone'),
            expectedRevision: asStateRevision(0), condition: 'prone', active: true,
        }).accepted).toBeTrue();
        const before = fixture.instance.query().mekMovementPsr();
        expect(before.kind).toBe('supported');
        if (before.kind !== 'supported') return;
        expect(before.standing).toEqual(jasmine.objectContaining({
            attempts: 0,
            movementPointsSpent: 0,
            movementMode: 'walk',
            requiresPilotCheck: true,
            targetNumber: 4,
            standingModifier: -1,
            supportsCarefulStand: false,
            canCarefulStand: false,
        }));

        expect(fixture.instance.dispatch({
            type: 'prepare-mek-stand', commandId: asCommandId('standing:core:prepare'),
            expectedRevision: asStateRevision(1),
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'resolve-mek-stand-attempt', commandId: asCommandId('standing:core:fail'),
            expectedRevision: asStateRevision(2), carefulStand: false,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        }).accepted).toBeTrue();

        const query = fixture.instance.query();
        const movement = query.mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(query.hasCondition('prone')).toBeTrue();
        expect(movement.standing.attempts).toBe(1);
        expect(movement.standing.movementPointsSpent).toBe(2);
        expect(movement.actions.find(action => action.kind === 'walk')?.maximumMp).toBe(5);
        expect(movement.declaration?.maximumMp).toBe(3);
        const heat = query.heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.find(source => source.id === 'movement')?.value).toBe(1);
    });

    it('applies Total Warfare careful-standing movement and heat exactly once', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');

        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('standing:tw:prone'),
            expectedRevision: asStateRevision(0), condition: 'prone', active: true,
        }).accepted).toBeTrue();
        const before = fixture.instance.query().mekMovementPsr();
        expect(before.kind).toBe('supported');
        if (before.kind !== 'supported') return;
        expect(before.standing).toEqual(jasmine.objectContaining({
            targetNumber: 5,
            standingModifier: 0,
            supportsCarefulStand: true,
            canCarefulStand: true,
        }));

        expect(fixture.instance.dispatch({
            type: 'prepare-mek-stand', commandId: asCommandId('standing:tw:prepare'),
            expectedRevision: asStateRevision(1),
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'resolve-mek-stand-attempt', commandId: asCommandId('standing:tw:fail'),
            expectedRevision: asStateRevision(2), carefulStand: true,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        }).accepted).toBeTrue();

        const query = fixture.instance.query();
        const movement = query.mekMovementPsr();
        expect(movement.kind).toBe('supported');
        if (movement.kind !== 'supported') return;
        expect(query.hasCondition('prone')).toBeTrue();
        expect(movement.standing).toEqual(jasmine.objectContaining({
            attempts: 1,
            carefulStand: true,
            movementPointsSpent: 5,
        }));
        expect(movement.actions.filter(action =>
            action.kind === 'walk' || action.kind === 'run' || action.kind === 'jump')
            .every(action => !action.legal)).toBeTrue();
        const heat = query.heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.committedSources.find(source => source.id === 'movement')?.value).toBe(2);

        const serialized = serializeMekMovementPsrStateV2(query.mekMovementPsrState());
        expect(serialized.standAttempts).toBe(1);
        expect(serialized.carefulStand).toBeTrue();
        expect(serializeMekMovementPsrStateV2(
            deserializeMekMovementPsrStateV2(serialized),
        )).toEqual(serialized);

        expect(fixture.instance.dispatch({
            type: 'adjust-mek-stand-attempts', commandId: asCommandId('standing:tw:undo'),
            expectedRevision: asStateRevision(3), delta: -1,
        }).accepted).toBeTrue();
        expect(fixture.instance.query().mekMovementPsrState()).toEqual(jasmine.objectContaining({
            standAttempts: 0,
            carefulStand: false,
        }));
    });

    it('ports destroyed-leg movement and Total Warfare Running Minimum Movement', () => {
        const destroyLeg = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            locationCode: string,
            commandId: string,
        ) => {
            const location = [...fixture.index.locations.values()]
                .find(candidate => candidate.code === locationCode)!;
            return fixture.instance.dispatch({
                type: 'damage-internal',
                commandId: asCommandId(commandId),
                expectedRevision: fixture.instance.query().stateRevision,
                locationId: location.id,
                amount: location.internalPoints,
                target: 'committed',
            });
        };
        const movement = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>) => {
            const projection = fixture.instance.query().mekMovementPsr();
            expect(projection.kind).toBe('supported');
            if (projection.kind !== 'supported') throw new Error('Fixture movement must be supported');
            return projection;
        };
        const runAction = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>) =>
            movement(fixture).actions.find(action => action.kind === 'run')!;

        const core = createDirectMekRuntimeFixture('core-2026', 'unit:core-destroyed-leg-movement');
        expect(destroyLeg(core, 'LL', 'core-destroyed-leg-movement:destroy').accepted).toBeTrue();
        expect(movement(core)).toEqual(jasmine.objectContaining({
            walkMp: 1,
            runMp: 2,
            maximumRunMp: 2,
        }));
        expect(runAction(core)).toEqual(jasmine.objectContaining({
            legal: true,
            ordinaryMaximumMp: 2,
            maximumMp: 2,
        }));

        const tw = createDirectMekRuntimeFixture('total-warfare', 'unit:tw-running-minimum');
        expect(destroyLeg(tw, 'LL', 'tw-running-minimum:destroy').accepted).toBeTrue();
        expect(movement(tw)).toEqual(jasmine.objectContaining({
            immobile: false,
            walkMp: 1,
            runMp: 0,
            maximumRunMp: 0,
        }));
        expect(runAction(tw)).toEqual(jasmine.objectContaining({
            legal: true,
            ordinaryMaximumMp: 1,
            maximumMp: 1,
        }));

        expect(tw.instance.dispatch({
            type: 'set-condition',
            commandId: asCommandId('tw-running-minimum:prone'),
            expectedRevision: tw.instance.query().stateRevision,
            condition: 'prone',
            active: true,
        }).accepted).toBeTrue();
        expect(runAction(tw).reasons.some(reason => reason.code === 'PRONE')).toBeFalse();
        expect(tw.instance.dispatch({
            type: 'declare-mek-movement',
            commandId: asCommandId('tw-running-minimum:declare'),
            expectedRevision: tw.instance.query().stateRevision,
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run',
                distance: 1,
                boosterComponentIds: [],
            },
        }).accepted).toBeTrue();
        expect(runAction(tw).requiresPilotCheck).toBeFalse();
        expect(tw.instance.query().mekPilotChecks().filter(check =>
            check.source.sourceKind === 'movement')).toEqual([]);

        expect(tw.instance.dispatch({
            type: 'resolve-mek-stand-attempt',
            commandId: asCommandId('tw-running-minimum:stand'),
            expectedRevision: tw.instance.query().stateRevision,
            carefulStand: false,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
        }).accepted).toBeTrue();
        const afterStand = movement(tw);
        expect(afterStand.standing.movementPointsSpent).toBe(2);
        expect(afterStand.actions.find(action => action.kind === 'run')).toEqual(
            jasmine.objectContaining({ legal: true, maximumMp: 1 }),
        );
        expect(afterStand.declaration).toEqual(jasmine.objectContaining({
            legal: true,
            maximumMp: 0,
        }));
        expect(tw.instance.query().mekMovementPsrState().movement).toEqual(
            jasmine.objectContaining({ mode: 'run', distance: 0 }),
        );

        const overheated = createDirectMekRuntimeFixture(
            'total-warfare',
            'unit:tw-no-running-minimum',
        );
        expect(destroyLeg(overheated, 'LL', 'tw-no-running-minimum:destroy').accepted).toBeTrue();
        expect(overheated.instance.dispatch({
            type: 'set-heat',
            commandId: asCommandId('tw-no-running-minimum:heat'),
            expectedRevision: overheated.instance.query().stateRevision,
            heat: 5,
        }).accepted).toBeTrue();
        expect(movement(overheated)).toEqual(jasmine.objectContaining({
            immobile: false,
            walkMp: 0,
            runMp: 0,
        }));
        expect(runAction(overheated)).toEqual(jasmine.objectContaining({
            legal: false,
            maximumMp: 0,
        }));
    });

    it('floors Core Walking MP lost to leg actuator damage at 1 while legs survive', () => {
        const scenarios = [
            { label: 'biped', fixture: createDirectLegDamageFloorRuntimeFixture('biped'), leg: 'LL' },
            { label: 'tripod', fixture: createDirectLegDamageFloorRuntimeFixture('tripod'), leg: 'LL' },
            { label: 'quad', fixture: createDirectLegDamageFloorRuntimeFixture('quad'), leg: 'RLL' },
        ];

        for (const scenario of scenarios) {
            const slots = [...scenario.fixture.index.slots.values()].filter(slot =>
                scenario.fixture.index.locations.get(slot.locationId)?.code === scenario.leg
                && slot.componentIds.some(componentId => {
                    const component = scenario.fixture.index.components.get(componentId);
                    return component?.kind === 'system'
                        && ['Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator']
                            .includes(component.systemType);
                }));
            expect(slots.length).withContext(scenario.label).toBe(3);
            for (const [index, slot] of slots.entries()) {
                expect(scenario.fixture.instance.dispatch({
                    type: 'hit-critical',
                    commandId: asCommandId(`leg-floor:${scenario.label}:${index}`),
                    expectedRevision: scenario.fixture.instance.query().stateRevision,
                    slotId: slot.id,
                    hits: 1,
                    target: 'committed',
                }).accepted).withContext(scenario.label).toBeTrue();
            }
            const movement = scenario.fixture.instance.query().mekMovementPsr();
            expect(movement.kind).withContext(scenario.label).toBe('supported');
            if (movement.kind !== 'supported') continue;
            expect(movement.walkMp).withContext(scenario.label).toBe(1);
            expect(movement.runMp).withContext(scenario.label).toBe(2);
        }
    });

    it('ports Core and Total Warfare Quad leg-loss movement', () => {
        const movement = (fixture: ReturnType<typeof createDirectQuadRuntimeFixture>) => {
            const projection = fixture.instance.query().mekMovementPsr();
            expect(projection.kind).toBe('supported');
            if (projection.kind !== 'supported') throw new Error('Quad movement must be supported');
            return projection;
        };
        const destroyLeg = (
            fixture: ReturnType<typeof createDirectQuadRuntimeFixture>,
            locationCode: string,
            commandId: string,
        ) => {
            const location = [...fixture.index.locations.values()]
                .find(candidate => candidate.code === locationCode)!;
            return fixture.instance.dispatch({
                type: 'damage-internal',
                commandId: asCommandId(commandId),
                expectedRevision: fixture.instance.query().stateRevision,
                locationId: location.id,
                amount: location.internalPoints,
                target: 'committed',
            });
        };
        const hitActuator = (
            fixture: ReturnType<typeof createDirectQuadRuntimeFixture>,
            locationCode: string,
            systemType: 'Hip' | 'Upper Leg Actuator',
            commandId: string,
        ) => {
            const slot = [...fixture.index.slots.values()].find(candidate =>
                fixture.index.locations.get(candidate.locationId)?.code === locationCode
                && candidate.componentIds.some(componentId => {
                    const component = fixture.index.components.get(componentId);
                    return component?.kind === 'system' && component.systemType === systemType;
                }))!;
            return fixture.instance.dispatch({
                type: 'hit-critical',
                commandId: asCommandId(commandId),
                expectedRevision: fixture.instance.query().stateRevision,
                slotId: slot.id,
                hits: 1,
                target: 'committed',
            });
        };

        const core = createDirectQuadRuntimeFixture('core-2026', 'unit:core-quad-three-legs');
        for (const code of ['FLL', 'FRL', 'RLL']) {
            expect(destroyLeg(core, code, `core-quad-three-legs:${code}`).accepted).toBeTrue();
        }
        expect(hitActuator(
            core,
            'RRL',
            'Upper Leg Actuator',
            'core-quad-three-legs:remaining-actuator',
        ).accepted).toBeTrue();
        expect(movement(core)).toEqual(jasmine.objectContaining({
            walkMp: 1,
            runMp: 2,
            maximumRunMp: 2,
        }));

        const coreTwo = createDirectQuadRuntimeFixture('core-2026', 'unit:core-quad-two-legs');
        expect(destroyLeg(coreTwo, 'FLL', 'core-quad-two-legs:FLL').accepted).toBeTrue();
        expect(destroyLeg(coreTwo, 'FRL', 'core-quad-two-legs:FRL').accepted).toBeTrue();
        expect(movement(coreTwo).actions.find(action => action.kind === 'run')?.requiresPilotCheck)
            .toBeFalse();
        expect(coreTwo.instance.dispatch({
            type: 'declare-mek-movement',
            commandId: asCommandId('core-quad-two-legs:run'),
            expectedRevision: coreTwo.instance.query().stateRevision,
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'run',
                distance: 1,
                boosterComponentIds: [],
            },
        }).accepted).toBeTrue();
        expect(movement(coreTwo).actions.find(action => action.kind === 'run')?.requiresPilotCheck)
            .toBeTrue();
        expect(coreTwo.instance.query().mekPilotChecks().filter(check =>
            check.source.sourceKind === 'movement')).toEqual([
            jasmine.objectContaining({ reason: 'Running with damaged hip' }),
        ]);

        const tw = createDirectQuadRuntimeFixture('total-warfare', 'unit:tw-quad-two-legs');
        expect(destroyLeg(tw, 'FLL', 'tw-quad-two-legs:FLL').accepted).toBeTrue();
        expect(destroyLeg(tw, 'FRL', 'tw-quad-two-legs:FRL').accepted).toBeTrue();
        expect(movement(tw)).toEqual(jasmine.objectContaining({
            walkMp: 1,
            runMp: 0,
            maximumRunMp: 0,
        }));
        expect(movement(tw).actions.find(action => action.kind === 'run')).toEqual(
            jasmine.objectContaining({ legal: true, maximumMp: 1, ordinaryMaximumMp: 1 }),
        );

        const twHip = createDirectQuadRuntimeFixture('total-warfare', 'unit:tw-quad-hip');
        expect(destroyLeg(twHip, 'FLL', 'tw-quad-hip:FLL').accepted).toBeTrue();
        expect(hitActuator(twHip, 'RRL', 'Hip', 'tw-quad-hip:hip').accepted).toBeTrue();
        expect(movement(twHip)).toEqual(jasmine.objectContaining({ walkMp: 2, runMp: 3 }));
    });

    it('applies submerged heat-sink cooling from the shared Mek water state', () => {
        const fixture = createDirectMekRuntimeFixture();
        const initialTurn = fixture.instance.query().turnState();

        expect(fixture.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('heat-water:submerged'),
            expectedRevision: asStateRevision(0),
            turn: { ...initialTurn, cover: 'underwater-depth-2' },
        }).accepted).toBeTrue();
        let heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.capacity).toBe(16);
        expect(heat.projection.underwaterBonus).toBe(6);

        expect(fixture.instance.dispatch({
            type: 'replace-turn-state', commandId: asCommandId('heat-water:partial'),
            expectedRevision: asStateRevision(1),
            turn: { ...fixture.instance.query().turnState(), cover: 'underwater-depth-1' },
        }).accepted).toBeTrue();
        heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.capacity).toBe(10);
        expect(heat.projection.underwaterBonus).toBe(0);

        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('heat-water:prone'),
            expectedRevision: asStateRevision(2), condition: 'prone', active: true,
        }).accepted).toBeTrue();
        heat = fixture.instance.query().heatProjection('manual');
        expect(heat.kind).toBe('supported');
        if (heat.kind !== 'supported') return;
        expect(heat.projection.capacity).toBe(16);
        expect(heat.projection.underwaterBonus).toBe(6);
    });

    it('subtracts only the surviving partial-wing bonus from jump heat', () => {
        const currentMovementHeat = (
            fixture: ReturnType<typeof createDirectPartialWingRuntimeFixture>,
        ): number | undefined => {
            const heat = fixture.instance.query().heatProjection('manual');
            expect(heat.kind).toBe('supported');
            if (heat.kind !== 'supported') return undefined;
            return heat.projection.committedSources.find(source => source.id === 'movement')?.value;
        };
        const movementHeat = (
            fixture: ReturnType<typeof createDirectPartialWingRuntimeFixture>,
            distance: number,
        ): number | undefined => {
            expect(fixture.instance.dispatch({
                type: 'declare-mek-movement',
                commandId: asCommandId(`partial-wing:jump:${distance}`),
                expectedRevision: fixture.instance.query().stateRevision,
                declaration: {
                    schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                    mode: 'jump',
                    distance,
                    boosterComponentIds: [],
                },
            }).accepted).toBeTrue();
            return currentMovementHeat(fixture);
        };

        const intact = createDirectPartialWingRuntimeFixture(
            'core-2026', 'unit:partial-wing:intact',
        );
        expect(movementHeat(intact, 6)).toBe(4);

        const damaged = createDirectPartialWingRuntimeFixture(
            'core-2026', 'unit:partial-wing:damaged',
        );
        expect(movementHeat(damaged, 6)).toBe(4);
        const wing = damaged.equipmentComponent('Test Partial Wing');
        const wingSlot = [...damaged.index.slots.values()].find(slot =>
            slot.componentIds.includes(wing.id))!;
        expect(damaged.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId('partial-wing:damage'),
            expectedRevision: damaged.instance.query().stateRevision,
            slotId: wingSlot.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(currentMovementHeat(damaged)).toBe(5);

        const minimum = createDirectPartialWingRuntimeFixture(
            'core-2026', 'unit:partial-wing:minimum',
        );
        expect(movementHeat(minimum, 3)).toBe(3);
    });

    it('clears prone only after a successful standing roll', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');

        expect(fixture.instance.dispatch({
            type: 'set-condition', commandId: asCommandId('standing:success:prone'),
            expectedRevision: asStateRevision(0), condition: 'prone', active: true,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'resolve-mek-stand-attempt', commandId: asCommandId('standing:success:roll'),
            expectedRevision: asStateRevision(1), carefulStand: false,
            evidence: { dice: [6, 6], claimedOutcome: 'success' },
        }).accepted).toBeTrue();

        expect(fixture.instance.query().hasCondition('prone')).toBeFalse();
        expect(fixture.instance.query().mekMovementPsrState().standAttempts).toBe(1);
    });

    it('uses the Core Heavy-Duty Gyro modifier and fourth-hit destruction rules', () => {
        const fixture = createDirectMekRuntimeFixture(
            'core-2026',
            'unit:core-heavy-duty-gyro',
            'Heavy Duty',
        );
        const gyro = [...fixture.index.components.values()].find(component =>
            component.kind === 'system' && component.systemType === 'Gyro');
        if (!gyro || gyro.kind !== 'system') throw new Error('Fixture gyro is missing');
        const slots = [...fixture.index.slots.values()]
            .filter(slot => slot.componentIds.includes(gyro.id))
            .sort((left, right) => left.slotIndex - right.slotIndex);
        expect(slots.length).toBe(4);

        for (let index = 0; index < 3; index += 1) {
            expect(fixture.instance.dispatch({
                type: 'hit-critical',
                commandId: asCommandId(`core-heavy-duty:${index + 1}`),
                expectedRevision: fixture.instance.query().stateRevision,
                slotId: slots[index]!.id,
                hits: 1,
                target: 'committed',
            }).accepted).toBeTrue();
            const projection = fixture.instance.query().mekMovementPsr();
            expect(projection.kind).toBe('supported');
            if (projection.kind !== 'supported') return;
            expect(projection.permanentPsrModifier).toBe(index + 1);
            expect(fixture.instance.query().mekPilotChecks()).toEqual([]);
            expect(fixture.instance.query().mekMovementPsrState().automaticFalls).toEqual([]);
        }

        expect(fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId('core-heavy-duty:4'),
            expectedRevision: fixture.instance.query().stateRevision,
            slotId: slots[3]!.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().mekMovementPsrState().automaticFalls).toEqual([
            jasmine.objectContaining({ triggerKind: 'gyro-destroyed' }),
        ]);
    });

    it('ports Core and Total Warfare permanent leg-actuator PSR values with their breakdown', () => {
        const slotFor = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            systemType: 'Hip' | 'Foot Actuator',
        ) => [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'LL'
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === systemType;
            }))!;
        const hit = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            systemType: 'Hip' | 'Foot Actuator',
            commandId: string,
        ) => fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId(commandId),
            expectedRevision: fixture.instance.query().stateRevision,
            slotId: slotFor(fixture, systemType).id,
            hits: 1,
            target: 'committed',
        });

        const core = createDirectMekRuntimeFixture('core-2026', 'unit:core-leg-psr');
        expect(hit(core, 'Foot Actuator', 'core-leg-psr:foot').accepted).toBeTrue();
        let projection = core.instance.query().mekMovementPsr();
        expect(projection.kind).toBe('supported');
        if (projection.kind !== 'supported') return;
        expect(projection.permanentPsrModifier).toBe(0);
        expect(projection.permanentPsrModifiers).toEqual([]);
        expect(core.instance.query().mekPilotChecks()).toEqual([]);
        expect(hit(core, 'Hip', 'core-leg-psr:hip').accepted).toBeTrue();
        projection = core.instance.query().mekMovementPsr();
        expect(projection.kind).toBe('supported');
        if (projection.kind !== 'supported') return;
        expect(projection.permanentPsrModifier).toBe(1);
        expect(projection.permanentPsrModifiers).toContain(jasmine.objectContaining({
            modifier: 1,
            reason: 'Hip Destroyed',
            locationId: core.index.locations.get(slotFor(core, 'Hip').locationId)!.id,
        }));

        const tw = createDirectMekRuntimeFixture('total-warfare', 'unit:tw-leg-psr');
        expect(hit(tw, 'Foot Actuator', 'tw-leg-psr:foot').accepted).toBeTrue();
        expect(tw.instance.query().mekPilotChecks()).toContain(jasmine.objectContaining({
            reason: 'Leg Actuator hit',
        }));
        expect(hit(tw, 'Hip', 'tw-leg-psr:hip').accepted).toBeTrue();
        projection = tw.instance.query().mekMovementPsr();
        expect(projection.kind).toBe('supported');
        if (projection.kind !== 'supported') return;
        expect(projection.permanentPsrModifier).toBe(3);
        expect(projection.permanentPsrModifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ modifier: 2, reason: 'Hip Destroyed' }),
            jasmine.objectContaining({ modifier: 1, reason: 'Leg Actuator(s) Destroyed' }),
        ]));
    });

    it('consolidates Core hip and leg-actuator checks per leg, including jump damage', () => {
        const slotFor = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            locationCode: 'LL' | 'RL',
            systemType: 'Hip' | 'Upper Leg Actuator' | 'Lower Leg Actuator' | 'Foot Actuator',
        ) => [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === locationCode
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === systemType;
            }))!;
        const hit = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            locationCode: 'LL' | 'RL',
            systemType: 'Hip' | 'Upper Leg Actuator' | 'Lower Leg Actuator' | 'Foot Actuator',
            commandId: string,
        ) => fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId(commandId),
            expectedRevision: fixture.instance.query().stateRevision,
            slotId: slotFor(fixture, locationCode, systemType).id,
            hits: 1,
            target: 'committed',
        });

        const sameLeg = createDirectMekRuntimeFixture('core-2026', 'unit:core-grouped-leg-check');
        expect(hit(sameLeg, 'LL', 'Upper Leg Actuator', 'core-grouped:upper').accepted).toBeTrue();
        expect(hit(sameLeg, 'LL', 'Lower Leg Actuator', 'core-grouped:lower').accepted).toBeTrue();
        expect(hit(sameLeg, 'LL', 'Hip', 'core-grouped:hip').accepted).toBeTrue();
        expect(sameLeg.instance.query().mekMovementPsrState().checks.length).toBe(3);
        let displayed = sameLeg.instance.query().mekPilotChecks();
        expect(displayed).toEqual([jasmine.objectContaining({
            reason: 'Hip hit, Leg Actuator hit',
        })]);
        expect(projectMekTurnPanel(
            sameLeg.entity,
            sameLeg.index,
            sameLeg.instance.ruleset(),
            sameLeg.instance.query(),
            'manual',
        ).movementState.checks).toEqual(displayed);

        expect(sameLeg.instance.dispatch({
            type: 'resolve-mek-pilot-check',
            commandId: asCommandId('core-grouped:resolve'),
            expectedRevision: sameLeg.instance.query().stateRevision,
            checkId: displayed[0]!.checkId,
            evidence: { dice: [6, 6], claimedOutcome: 'success' },
        }).accepted).toBeTrue();
        expect(sameLeg.instance.query().mekMovementPsrState().checks.every(check =>
            check.status === 'success')).toBeTrue();
        displayed = sameLeg.instance.query().mekPilotChecks();
        expect(displayed).toEqual([jasmine.objectContaining({
            reason: 'Hip hit, Leg Actuator hit',
            status: 'success',
        })]);

        const jumping = createDirectShieldRuntimeFixture(
            'core-2026',
            'small',
            'unit:core-grouped-jump-check',
        );
        expect(hit(jumping, 'LL', 'Hip', 'core-jump:hip').accepted).toBeTrue();
        expect(hit(jumping, 'LL', 'Upper Leg Actuator', 'core-jump:upper').accepted).toBeTrue();
        expect(hit(jumping, 'LL', 'Foot Actuator', 'core-jump:foot').accepted).toBeTrue();
        expect(jumping.instance.dispatch({
            type: 'declare-mek-movement',
            commandId: asCommandId('core-jump:declare'),
            expectedRevision: jumping.instance.query().stateRevision,
            declaration: { schemaVersion: 1, mode: 'jump', distance: 1, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(jumping.instance.query().mekPilotChecks()).toEqual([jasmine.objectContaining({
            reason: 'Hip hit, Leg Actuator hit, Foot hit',
        })]);

        const separateLegs = createDirectMekRuntimeFixture('core-2026', 'unit:core-separate-leg-checks');
        expect(hit(separateLegs, 'LL', 'Upper Leg Actuator', 'core-separate:left').accepted).toBeTrue();
        expect(hit(separateLegs, 'RL', 'Hip', 'core-separate:right').accepted).toBeTrue();
        expect(separateLegs.instance.query().mekPilotChecks()).toEqual([
            jasmine.objectContaining({ reason: 'Leg Actuator hit' }),
            jasmine.objectContaining({ reason: 'Hip hit' }),
        ]);
    });

    it('uses Total Warfare turn chronology for same-leg hip and actuator damage', () => {
        const slotFor = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            systemType: 'Hip' | 'Upper Leg Actuator',
        ) => [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'LL'
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === systemType;
            }))!;
        const hit = (
            fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
            systemType: 'Hip' | 'Upper Leg Actuator',
            commandId: string,
        ) => fixture.instance.dispatch({
            type: 'hit-critical',
            commandId: asCommandId(commandId),
            expectedRevision: fixture.instance.query().stateRevision,
            slotId: slotFor(fixture, systemType).id,
            hits: 1,
            target: 'committed',
        });
        const resolveChecks = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>, prefix: string) => {
            for (const check of fixture.instance.query().mekPilotChecks()) {
                if (check.status !== 'pending') continue;
                expect(fixture.instance.dispatch({
                    type: 'resolve-mek-pilot-check',
                    commandId: asCommandId(`${prefix}:${check.checkId}`),
                    expectedRevision: fixture.instance.query().stateRevision,
                    checkId: check.checkId,
                    evidence: { dice: [6, 6], claimedOutcome: 'success' },
                }).accepted).toBeTrue();
            }
        };
        const endTurn = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>, commandId: string) => {
            resolveChecks(fixture, `${commandId}:resolve`);
            expect(fixture.instance.dispatch({
                type: 'end-turn',
                commandId: asCommandId(commandId),
                expectedRevision: fixture.instance.query().stateRevision,
                policy: 'automatic',
            }).accepted).toBeTrue();
        };
        const movement = (fixture: ReturnType<typeof createDirectMekRuntimeFixture>) => {
            const projection = fixture.instance.query().mekMovementPsr();
            expect(projection.kind).toBe('supported');
            if (projection.kind !== 'supported') throw new Error('Fixture mechanics must be supported');
            return projection;
        };

        const sameTurn = createDirectMekRuntimeFixture('total-warfare', 'unit:tw-same-turn-leg-damage');
        endTurn(sameTurn, 'tw-same-turn:advance');
        expect(hit(sameTurn, 'Upper Leg Actuator', 'tw-same-turn:actuator').accepted).toBeTrue();
        expect(hit(sameTurn, 'Hip', 'tw-same-turn:hip').accepted).toBeTrue();
        expect(movement(sameTurn)).toEqual(jasmine.objectContaining({
            permanentPsrModifier: 3,
            walkMp: 2,
        }));
        expect(sameTurn.instance.snapshot().slots.get(slotFor(sameTurn, 'Hip').id)?.destroyedTurn)
            .toBe(1);
        expect(sameTurn.instance.snapshot().slots.get(slotFor(sameTurn, 'Upper Leg Actuator').id)?.destroyedTurn)
            .toBe(1);
        expect(sameTurn.instance.dispatch({
            type: 'repair-critical',
            commandId: asCommandId('tw-same-turn:repair-hip'),
            expectedRevision: sameTurn.instance.query().stateRevision,
            slotId: slotFor(sameTurn, 'Hip').id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(sameTurn.instance.snapshot().slots.get(slotFor(sameTurn, 'Hip').id)).toBeUndefined();

        const laterHip = createDirectMekRuntimeFixture('total-warfare', 'unit:tw-later-hip');
        expect(hit(laterHip, 'Upper Leg Actuator', 'tw-later-hip:actuator').accepted).toBeTrue();
        endTurn(laterHip, 'tw-later-hip:advance');
        expect(hit(laterHip, 'Hip', 'tw-later-hip:hip').accepted).toBeTrue();
        expect(movement(laterHip)).toEqual(jasmine.objectContaining({
            permanentPsrModifier: 2,
            walkMp: 3,
        }));

        const laterActuator = createDirectMekRuntimeFixture('total-warfare', 'unit:tw-later-actuator');
        expect(hit(laterActuator, 'Hip', 'tw-later-actuator:hip').accepted).toBeTrue();
        endTurn(laterActuator, 'tw-later-actuator:advance');
        expect(hit(laterActuator, 'Upper Leg Actuator', 'tw-later-actuator:actuator').accepted).toBeTrue();
        expect(movement(laterActuator)).toEqual(jasmine.objectContaining({
            permanentPsrModifier: 3,
            walkMp: 2,
        }));
    });

    it('uses the production destroyed-leg PSR values for both rulesets', () => {
        for (const [ruleset, expected] of [['core-2026', 4], ['total-warfare', 5]] as const) {
            const fixture = createDirectMekRuntimeFixture(ruleset, `unit:${ruleset}:destroyed-leg-psr`);
            const leg = [...fixture.index.locations.values()].find(location => location.code === 'LL')!;
            expect(fixture.instance.dispatch({
                type: 'damage-internal',
                commandId: asCommandId(`${ruleset}:destroyed-leg-psr`),
                expectedRevision: fixture.instance.query().stateRevision,
                locationId: leg.id,
                amount: leg.internalPoints,
                target: 'committed',
            }).accepted).toBeTrue();
            const projection = fixture.instance.query().mekMovementPsr();
            expect(projection.kind).toBe('supported');
            if (projection.kind !== 'supported') return;
            expect(projection.permanentPsrModifier).toBe(expected);
            expect(projection.permanentPsrModifiers).toContain(jasmine.objectContaining({
                modifier: expected,
                reason: 'Leg Destroyed',
                locationId: leg.id,
            }));
        }
    });

    it('ports the aggregate Core and Total Warfare Quad destroyed-leg PSR rules', () => {
        const scenarios = [
            { ruleset: 'core-2026' as const, expected: [1, 2, 4, 0] },
            { ruleset: 'total-warfare' as const, expected: [0, 5, 0, 0] },
        ];
        for (const scenario of scenarios) {
            const fixture = createDirectQuadRuntimeFixture(
                scenario.ruleset,
                `unit:${scenario.ruleset}:quad-leg-psr`,
            );
            const legs = ['FLL', 'FRL', 'RLL', 'RRL'].map(code =>
                [...fixture.index.locations.values()].find(location => location.code === code)!);
            for (const [index, leg] of legs.entries()) {
                expect(fixture.instance.dispatch({
                    type: 'damage-internal',
                    commandId: asCommandId(`${scenario.ruleset}:quad-leg-psr:${index}`),
                    expectedRevision: fixture.instance.query().stateRevision,
                    locationId: leg.id,
                    amount: leg.internalPoints,
                    target: 'committed',
                }).accepted).toBeTrue();
                const projection = fixture.instance.query().mekMovementPsr();
                expect(projection.kind).toBe('supported');
                if (projection.kind !== 'supported') return;
                expect(projection.permanentPsrModifier)
                    .withContext(`${scenario.ruleset} with ${index + 1} destroyed Quad legs`)
                    .toBe(scenario.expected[index]!);
            }
        }
    });

    it('uses the TW Heavy-Duty Gyro first-hit, run, and third-hit rules', () => {
        const fixture = createDirectMekRuntimeFixture(
            'total-warfare',
            'unit:tw-heavy-duty-gyro',
            'Heavy Duty',
        );
        const gyro = [...fixture.index.components.values()].find(component =>
            component.kind === 'system' && component.systemType === 'Gyro');
        if (!gyro || gyro.kind !== 'system') throw new Error('Fixture gyro is missing');
        const slots = [...fixture.index.slots.values()]
            .filter(slot => slot.componentIds.includes(gyro.id))
            .sort((left, right) => left.slotIndex - right.slotIndex);

        expect(fixture.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('tw-heavy-duty:1'),
            expectedRevision: fixture.instance.query().stateRevision,
            slotId: slots[0]!.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        let projection = fixture.instance.query().mekMovementPsr();
        expect(projection.kind).toBe('supported');
        if (projection.kind !== 'supported') return;
        expect(projection.permanentPsrModifier).toBe(1);
        expect(fixture.instance.query().mekPilotChecks()).toEqual([
            jasmine.objectContaining({
                reason: 'Gyro hit',
                targetNumber: projection.pilotingTargetNumber,
                source: jasmine.objectContaining({ locationIds: jasmine.arrayWithExactContents([
                    slots[0]!.locationId,
                ]) }),
            }),
        ]);

        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement', commandId: asCommandId('tw-heavy-duty:run'),
            expectedRevision: fixture.instance.query().stateRevision,
            declaration: { schemaVersion: 1, mode: 'run', distance: 1, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(fixture.instance.query().mekPilotChecks()).toContain(jasmine.objectContaining({
            reason: 'Running with damaged gyro',
            targetNumber: projection.pilotingTargetNumber,
        }));

        for (let index = 1; index < 3; index += 1) {
            expect(fixture.instance.dispatch({
                type: 'hit-critical', commandId: asCommandId(`tw-heavy-duty:${index + 1}`),
                expectedRevision: fixture.instance.query().stateRevision,
                slotId: slots[index]!.id, hits: 1, target: 'committed',
            }).accepted).toBeTrue();
        }
        projection = fixture.instance.query().mekMovementPsr();
        expect(projection.kind).toBe('supported');
        if (projection.kind !== 'supported') return;
        expect(projection.permanentPsrModifier).toBe(3);
        expect(fixture.instance.query().mekMovementPsrState().automaticFalls).toEqual([
            jasmine.objectContaining({ triggerKind: 'gyro-destroyed' }),
        ]);
    });

    it('retains the second Core hit for a one-slot autocannon', () => {
        const core = createDirectMekRuntimeFixture('core-2026', 'unit:core-one-slot-ac');
        const coreAc = core.equipmentComponent('Test AC');
        const coreSlot = [...core.index.slots.values()].find(slot =>
            slot.componentIds.includes(coreAc.id))!;

        expect(core.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('core-one-slot-ac:1'),
            expectedRevision: core.instance.query().stateRevision,
            slotId: coreSlot.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(core.instance.query().componentStatus(coreAc.id)).toBe('available');
        expect(core.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('core-one-slot-ac:2'),
            expectedRevision: core.instance.query().stateRevision,
            slotId: coreSlot.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(core.instance.query().criticalHits(coreSlot.id)).toBe(2);
        expect(core.instance.query().componentStatus(coreAc.id)).toBe('destroyed');

        const tw = createDirectMekRuntimeFixture('total-warfare', 'unit:tw-one-slot-ac');
        const twAc = tw.equipmentComponent('Test AC');
        const twSlot = [...tw.index.slots.values()].find(slot => slot.componentIds.includes(twAc.id))!;
        expect(tw.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('tw-one-slot-ac:1'),
            expectedRevision: tw.instance.query().stateRevision,
            slotId: twSlot.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(tw.instance.query().componentStatus(twAc.id)).toBe('destroyed');
        expect(tw.instance.dispatch({
            type: 'hit-critical', commandId: asCommandId('tw-one-slot-ac:2'),
            expectedRevision: tw.instance.query().stateRevision,
            slotId: twSlot.id, hits: 1, target: 'committed',
        }).accepted).toBeFalse();
    });

    it('accepts committed damage for a gyro-less Mek without inventing a gyro fall', () => {
        const fixture = createDirectMekRuntimeFixture(
            'core-2026',
            'unit:no-gyro',
            'None',
        );
        const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 0)!;

        expect(fixture.instance.dispatch({
            type: 'damage-armor', commandId: asCommandId('no-gyro:damage'),
            expectedRevision: fixture.instance.query().stateRevision,
            faceId: face.id, amount: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().mekMovementPsrState().automaticFalls).toEqual([]);
    });

    it('absorbs damage with Modular Armor and removes its penalties only after every panel is depleted', () => {
        for (const ruleset of ['core-2026', 'total-warfare'] as const) {
            const fixture = createDirectModularArmorRuntimeFixture(
                ruleset,
                `unit:${ruleset}:modular-armor`,
            );
            const panels = [...fixture.index.components.values()]
                .filter(component => component.kind === 'equipment'
                    && component.mount.equipment?.hasFlag('F_MODULAR_ARMOR') === true)
                .map(component => {
                    const slot = [...fixture.index.slots.values()].find(candidate =>
                        candidate.componentIds.includes(component.id))!;
                    const location = fixture.index.locations.get(slot.locationId)!;
                    const face = [...fixture.index.armorFaces.values()].find(candidate =>
                        candidate.locationId === location.id && candidate.face === 'front')!;
                    return { component, location, face };
                })
                .sort((left, right) => left.location.code.localeCompare(right.location.code));
            expect(panels.length).toBe(2);

            const movement = () => {
                const projection = fixture.instance.query().mekMovementPsr();
                expect(projection.kind).toBe('supported');
                if (projection.kind !== 'supported') {
                    throw new Error('Modular Armor fixture mechanics must be supported');
                }
                return projection;
            };
            expect(movement()).toEqual(jasmine.objectContaining({
                walkMp: 4,
                jumpMp: 1,
                permanentPsrModifier: 1,
            }));

            for (const [index, panel] of panels.entries()) {
                const beforeArmor = fixture.instance.query().remainingArmor(panel.face.id);
                expect(fixture.instance.dispatch({
                    type: 'damage-armor',
                    commandId: asCommandId(`${ruleset}:modular:damage:${index}`),
                    expectedRevision: fixture.instance.query().stateRevision,
                    faceId: panel.face.id,
                    amount: 10,
                    target: 'pending',
                }).accepted).toBeTrue();
                expect(fixture.instance.query().modularArmorDamage(panel.component.id, 'committed')).toBe(0);
                expect(fixture.instance.query().modularArmorDamage(panel.component.id, 'preview')).toBe(10);
                expect(fixture.instance.query().remainingArmor(panel.face.id, 'preview')).toBe(beforeArmor);
                expect(fixture.instance.dispatch({
                    type: 'commit-pending',
                    commandId: asCommandId(`${ruleset}:modular:commit:${index}`),
                    expectedRevision: fixture.instance.query().stateRevision,
                }).accepted).toBeTrue();
                expect(fixture.instance.query().modularArmorRemaining(panel.component.id)).toBe(0);
            }

            expect(movement()).toEqual(jasmine.objectContaining({
                walkMp: 5,
                jumpMp: 2,
                permanentPsrModifier: 0,
            }));
            const sheet = projectMekRecordSheet(
                fixture.entity,
                fixture.index,
                ruleset,
                fixture.instance.snapshot(),
                fixture.instance.query(),
                emptyCBTEncounterSnapshot(),
                null,
            );
            expect(sheet.locations.filter(location => location.modularArmor.maximum > 0))
                .toEqual(jasmine.arrayWithExactContents([
                    jasmine.objectContaining({ modularArmor: jasmine.objectContaining({
                        maximum: 10,
                        committedDamage: 10,
                        committedRemaining: 0,
                    }) }),
                    jasmine.objectContaining({ modularArmor: jasmine.objectContaining({
                        maximum: 10,
                        committedDamage: 10,
                        committedRemaining: 0,
                    }) }),
                ]));

            expect(fixture.instance.dispatch({
                type: 'repair-armor',
                commandId: asCommandId(`${ruleset}:modular:repair`),
                expectedRevision: fixture.instance.query().stateRevision,
                faceId: panels[0]!.face.id,
                amount: 10,
                target: 'pending',
            }).accepted).toBeTrue();
            expect(fixture.instance.query().modularArmorRemaining(panels[0]!.component.id, 'preview'))
                .toBe(10);
            expect(fixture.instance.query().mekMovementPsr()).toEqual(jasmine.objectContaining({
                permanentPsrModifier: 0,
            }));
            expect(fixture.instance.dispatch({
                type: 'commit-pending',
                commandId: asCommandId(`${ruleset}:modular:repair:commit`),
                expectedRevision: fixture.instance.query().stateRevision,
            }).accepted).toBeTrue();
            expect(movement()).toEqual(jasmine.objectContaining({
                walkMp: 4,
                jumpMp: 1,
                permanentPsrModifier: 1,
            }));
        }
    });
});
