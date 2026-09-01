// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    criticalRollDiceCount,
    projectMekBlowOffV2,
    projectMekCriticalChanceV2,
    projectMekCriticalRollProfileV2,
    projectMekCriticalRollV2,
    resolveMekCriticalChance,
} from './mek-critical-hit-v2';
import {
    createDirectBombastRuntimeFixture,
    createDirectEngineHeatRuntimeFixture,
    createDirectEscalatingFailureRuntimeFixture,
    createDirectExplosionRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectRiscLaserPulseRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';
import type { ComponentId } from '../entity/entity-identifiers';
import { BOMBAST_LASER_CHARGING_STATE } from './component-bombast-laser';
import { PPC_CAPACITOR_CHARGING_STATE } from './component-ppc-capacitor';

describe('direct Mek critical-hit rules', () => {
    it('resolves the production chance table and dice shape', () => {
        expect(resolveMekCriticalChance(7, true)).toEqual({ kind: 'none' });
        expect(resolveMekCriticalChance(8, true)).toEqual({ kind: 'critical-hits', count: 1 });
        expect(resolveMekCriticalChance(10, true)).toEqual({ kind: 'critical-hits', count: 2 });
        expect(resolveMekCriticalChance(12, true)).toEqual({ kind: 'blown-off' });
        expect(resolveMekCriticalChance(12, false)).toEqual({ kind: 'critical-hits', count: 3 });
        expect(resolveMekCriticalChance(13, false, true)).toEqual({ kind: 'critical-hits', count: 3 });
        expect(resolveMekCriticalChance(14, false, true)).toEqual({ kind: 'critical-hits', count: 4 });
        expect(criticalRollDiceCount('HD')).toBe(1);
        expect(criticalRollDiceCount('LL')).toBe(1);
        expect(criticalRollDiceCount('LA')).toBe(2);
    });

    it('selects the Total Warfare IndustrialMech table from entity facts', () => {
        const fixture = createDirectEngineHeatRuntimeFixture('Fusion', true, 'total-warfare');
        const torso = [...fixture.index.locations.values()].find(location => location.code === 'CT')!;
        const profile = projectMekCriticalChanceV2(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            torso.id,
            'committed',
        );

        expect(profile.industrialMek).toBeTrue();
        expect(profile.modifiers).toContain(jasmine.objectContaining({
            label: 'IndustrialMech', value: 2,
        }));
        expect(resolveMekCriticalChance(14, profile.canBlowOff, profile.industrialMek))
            .toEqual({ kind: 'critical-hits', count: 4 });
    });

    it('publishes only rolls that currently select a valid entity slot', () => {
        const fixture = createDirectMekRuntimeFixture();
        const arm = [...fixture.index.locations.values()].find(location => location.code === 'LA')!;
        const profile = projectMekCriticalRollProfileV2(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            arm.id,
            'pending',
        );
        expect(profile.targetLocationId).toBe(arm.id);
        expect(profile.diceCount).toBe(2);
        expect(profile.validRolls.length).toBe(12);
        expect(profile.validRolls.every(roll =>
            projectMekCriticalRollV2(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                arm.id,
                roll,
                'pending',
            ).kind === 'applied')).toBeTrue();
    });

    it('keeps a one-slot Core autocannon rollable for its second hit', () => {
        const fixture = createDirectMekRuntimeFixture();
        const ac = fixture.equipmentComponent('Test AC');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(ac.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        const dice = slot.slotIndex < 6
            ? [1, slot.slotIndex + 1]
            : [4, slot.slotIndex - 5];

        const first = projectMekCriticalRollV2(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.query(),
            location.id, dice, 'committed',
        );
        expect(first).toEqual(jasmine.objectContaining({ kind: 'applied', slotId: slot.id }));
        expect(fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: slot.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        expect(projectMekCriticalRollV2(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.query(),
            location.id, dice, 'committed',
        ).kind).toBe('applied');
    });

    it('plans remaining ammunition damage without consuming the bin', () => {
        const fixture = createDirectMekRuntimeFixture();
        const ammo = fixture.equipmentComponent('Test Ammo');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(ammo.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        const dice = slot.slotIndex < 6
            ? [1, slot.slotIndex + 1]
            : [4, slot.slotIndex - 5];
        const plan = projectMekCriticalRollV2(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            location.id,
            dice,
            'committed',
        );
        expect(plan.kind).toBe('applied');
        if (plan.kind !== 'applied') return;
        expect(plan.explosion?.rawDamage).toBe(100);
        expect(plan.explosion?.locations[0]).toEqual(jasmine.objectContaining({
            locationId: location.id,
        }));
        expect(plan.explosion!.locations[0]!.internalDamage).toBeGreaterThan(0);
        expect(fixture.instance.query().remainingAmmo(ammo.id)).toBe(20);

        const beforeInternal = [...fixture.index.locations.keys()].reduce((total, locationId) =>
            total + fixture.instance.query().remainingInternal(locationId), 0);
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',


            locationId: location.id,
            results: dice,
            target: 'committed',
        }).accepted).toBeTrue();
        const afterInternal = [...fixture.index.locations.keys()].reduce((total, locationId) =>
            total + fixture.instance.query().remainingInternal(locationId), 0);
        const pilot = [...fixture.index.crewPositions.values()].find(position => position.occurrence === 0)!;
        expect(afterInternal).toBeLessThan(beforeInternal);
        expect(fixture.instance.query().criticalHits(slot.id)).toBe(1);
        expect(fixture.instance.query().remainingAmmo(ammo.id)).toBe(20);
        expect(fixture.instance.query().crewState(pilot.id).wounds).toBe(1);
    });

    it('can retain an ammunition critical while independently skipping explosion and pilot-hit effects', () => {
        const skipExplosion = createDirectMekRuntimeFixture();
        const ammo = skipExplosion.equipmentComponent('Test Ammo');
        const slot = [...skipExplosion.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(ammo.id))!;
        const location = skipExplosion.index.locations.get(slot.locationId)!;
        const dice = criticalDice(slot.slotIndex);
        const beforeInternal = skipExplosion.instance.query().remainingInternal(location.id);
        expect(skipExplosion.instance.dispatch({
            type: 'apply-mek-critical-roll',

            locationId: location.id, results: dice, target: 'committed', applyExplosion: false,
        }).accepted).toBeTrue();
        expect(skipExplosion.instance.query().criticalHits(slot.id)).toBe(1);
        expect(skipExplosion.instance.query().remainingInternal(location.id)).toBe(beforeInternal);

        const skipPilot = createDirectMekRuntimeFixture();
        const secondAmmo = skipPilot.equipmentComponent('Test Ammo');
        const secondSlot = [...skipPilot.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(secondAmmo.id))!;
        const secondLocation = skipPilot.index.locations.get(secondSlot.locationId)!;
        const pilot = [...skipPilot.index.crewPositions.values()].find(position => position.occurrence === 0)!;
        expect(skipPilot.instance.dispatch({
            type: 'apply-mek-critical-roll',

            locationId: secondLocation.id, results: criticalDice(secondSlot.slotIndex),
            target: 'committed', applyPilotHits: false,
        }).accepted).toBeTrue();
        expect(skipPilot.instance.query().remainingInternal(secondLocation.id))
            .toBeLessThan(secondLocation.internalPoints);
        expect(skipPilot.instance.query().crewState(pilot.id).wounds).toBe(0);
    });

    it('suppresses a Gauss explosion only while the weapon is effectively powered down', () => {
        const fixture = createDirectMekRuntimeFixture();
        const gauss = fixture.equipmentComponent('Test HAG');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(gauss.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        const explosionDamage = () => {
            const plan = projectMekCriticalRollV2(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                location.id,
                criticalDice(slot.slotIndex),
                'committed',
            );
            return plan.kind === 'applied' ? plan.explosion?.rawDamage : undefined;
        };
        const toggle = (commandId: string) => fixture.instance.dispatch({
            type: 'toggle-gauss-power' as const,


            componentId: gauss.id,
        });
        const endTurn = (commandId: string) => fixture.instance.dispatch({
            type: 'end-turn' as const,


            policy: 'automatic' as const,
        });

        expect(explosionDamage()).toBeGreaterThan(0);
        expect(toggle('critical:gauss-powering-down').accepted).toBeTrue();
        expect(explosionDamage()).toBeGreaterThan(0);
        expect(endTurn('critical:gauss-powered-down').accepted).toBeTrue();
        expect(explosionDamage()).toBeUndefined();
        expect(toggle('critical:gauss-powering-up').accepted).toBeTrue();
        expect(explosionDamage()).toBeUndefined();
        expect(endTurn('critical:gauss-powered-up').accepted).toBeTrue();
        expect(explosionDamage()).toBeGreaterThan(0);
    });

    it('explodes an active Blue Shield for five damage but leaves an inactive one inert', () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture();
        const blueShield = fixture.equipmentComponent('Test Blue Shield');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(blueShield.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        const explosionDamage = () => {
            const plan = projectMekCriticalRollV2(
                fixture.entity,
                fixture.index,
                fixture.instance.ruleset(),
                fixture.instance.query(),
                location.id,
                criticalDice(slot.slotIndex),
                'committed',
            );
            return plan.kind === 'applied' ? plan.explosion?.rawDamage : undefined;
        };

        expect(explosionDamage()).toBeUndefined();
        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure',


            componentId: blueShield.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(explosionDamage()).toBe(5);

        expect(fixture.instance.dispatch({
            type: 'end-turn',


            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(explosionDamage()).toBeUndefined();
    });

    it('uses effective X and the active ruleset for ordinary weapon explosions', () => {
        const core = createDirectExplosionRuntimeFixture();
        const tw = createDirectExplosionRuntimeFixture('total-warfare');

        expect(criticalExplosionDamage(core, 'Test Explosive Weapon')).toBe(2);
        expect(criticalExplosionDamage(tw, 'Test Explosive Weapon')).toBe(15);
        expect(criticalExplosionDamage(core, 'Test Inert Weapon')).toBeUndefined();
        expect(criticalExplosionDamage(tw, 'Test Inert Weapon')).toBeUndefined();
        expect(criticalExplosionDamage(core, 'Test Explosive AC')).toBeUndefined();
        expect(criticalExplosionDamage(tw, 'Test Explosive AC')).toBeUndefined();
    });

    it('requires explosive misc equipment and applies every fixed-damage exception', () => {
        const fixture = createDirectExplosionRuntimeFixture('total-warfare');

        expect(criticalExplosionDamage(fixture, 'Test Explosive Misc')).toBe(2);
        expect(criticalExplosionDamage(fixture, 'Test Inert Misc')).toBeUndefined();
        expect(criticalExplosionDamage(fixture, 'Test Prototype Improved Jump Jet')).toBe(10);
        expect(criticalExplosionDamage(fixture, 'Test Fuel')).toBe(20);
        expect(criticalExplosionDamage(fixture, 'Test RISC Emergency Coolant')).toBe(5);
    });

    it('uses the ruleset-specific damage for a non-empty coolant pod', () => {
        const core = createDirectExplosionRuntimeFixture();
        const pod = core.equipmentComponent('Test Coolant Pod');
        expect(criticalExplosionDamage(core, 'Test Coolant Pod')).toBe(2);
        expect(criticalExplosionDamage(
            createDirectExplosionRuntimeFixture('total-warfare'),
            'Test Coolant Pod',
        )).toBe(10);

        expect(core.instance.dispatch({
            type: 'spend-ammo',

            componentId: pod.id, amount: 1,
        }).accepted).toBeTrue();
        expect(criticalExplosionDamage(core, 'Test Coolant Pod')).toBeUndefined();
    });

    it('turns an operational RISC pulse-module explosion into a linked laser critical', () => {
        const fixture = createDirectRiscLaserPulseRuntimeFixture('total-warfare');
        const module = fixture.equipmentComponent('Test RISC Laser Pulse Module');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const plan = criticalRollPlan(fixture, module.id);

        expect(plan.kind).toBe('applied');
        if (plan.kind !== 'applied') return;
        expect(plan.explosion).toEqual(jasmine.objectContaining({
            rawDamage: 2,
            automaticCritical: jasmine.objectContaining({
                equipment: 'Medium Laser',
                hits: 1,
            }),
        }));

        const laserSlot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(laser.id))!;
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',


            locationId: plan.targetLocationId,
            results: criticalDice(slotForComponent(fixture, module.id).slotIndex),
            target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().criticalHits(laserSlot.id)).toBe(1);

        const fresh = createDirectRiscLaserPulseRuntimeFixture('total-warfare');
        const freshModule = fresh.equipmentComponent('Test RISC Laser Pulse Module');
        const freshLaser = fresh.equipmentComponent('ISMediumLaser');

        expect(fresh.instance.dispatch({
            type: 'set-component-status',


            componentId: freshLaser.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        const inert = criticalRollPlan(fresh, freshModule.id);
        expect(inert.kind).toBe('applied');
        if (inert.kind === 'applied') expect(inert.explosion).toBeUndefined();
    });

    it('gives operational CASE II precedence over CASE in the source location', () => {
        const fixture = createDirectExplosionRuntimeFixture('core-2026', { protection: 'both' });
        const source = fixture.equipmentComponent('Test Explosive Weapon');
        const caseEquipment = fixture.equipmentComponent('Test CASE');
        const caseIIEquipment = fixture.equipmentComponent('Test CASE II');
        const protection = () => {
            const plan = criticalRollPlan(fixture, source.id);
            return plan.kind === 'applied' ? plan.explosion?.locations[0]?.protection : undefined;
        };

        expect(protection()).toBe('case-ii');
        expect(setCommittedComponentStatus(fixture, caseIIEquipment.id, 'destroyed', 'critical:case-ii')).toBeTrue();
        expect(protection()).toBe('case');
        expect(setCommittedComponentStatus(fixture, caseEquipment.id, 'destroyed', 'critical:case')).toBeTrue();
        expect(protection()).toBe('none');
    });

    it('marks two composite-structure pips for each point of explosion damage', () => {
        const fixture = createDirectExplosionRuntimeFixture('core-2026', { structure: 'Composite' });
        const source = fixture.equipmentComponent('Test Explosive Misc');
        const plan = criticalRollPlan(fixture, source.id);

        expect(plan.kind).toBe('applied');
        if (plan.kind !== 'applied') return;
        expect(plan.explosion?.rawDamage).toBe(2);
        expect(plan.explosion?.locations[0]?.internalDamage).toBe(4);
    });

    it('transfers uncased Total Warfare overflow through the Mek topology', () => {
        const fixture = createDirectExplosionRuntimeFixture('total-warfare');
        const source = fixture.equipmentComponent('Test Explosive Weapon');
        const plan = criticalRollPlan(fixture, source.id);

        expect(plan.kind).toBe('applied');
        if (plan.kind !== 'applied') return;
        expect(plan.explosion?.rawDamage).toBe(15);
        expect(plan.explosion!.locations.length).toBeGreaterThan(1);
        expect(plan.explosion!.locations[0]!.protection).toBe('none');
        expect(plan.explosion!.locations[1]!.internalDamage).toBeGreaterThan(0);
    });

    it('ignores malformed critical dice without changing the revision', () => {
        const fixture = createDirectMekRuntimeFixture();
        const arm = [...fixture.index.locations.values()].find(location => location.code === 'LA')!;
        const revision = fixture.instance.query().stateRevision;
        const result = fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',


            locationId: arm.id,
            results: [7, 1],
            target: 'committed',
        });
        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
        }));
        expect(fixture.instance.query().stateRevision).toBe(revision);
    });

    it('uses an armored shoulder as the first blow-off absorber', () => {
        const fixture = createDirectMekRuntimeFixture();
        const arm = [...fixture.index.locations.values()].find(location => location.code === 'LA')!;
        const shoulder = [...fixture.index.slots.values()].find(slot =>
            slot.locationId === arm.id
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Shoulder';
            }))!;
        expect(projectMekBlowOffV2(
            fixture.index,
            fixture.instance.query(),
            arm.id,
            'pending',
        )).toEqual(shoulder.armored
            ? { kind: 'absorbed', equipment: 'Shoulder', slotId: shoulder.id }
            : { kind: 'blown-off', locationId: arm.id });
        const result = fixture.instance.dispatch({
            type: 'apply-mek-blow-off',


            locationId: arm.id,
            target: 'pending',
        });
        expect(result.accepted).toBeTrue();
        if (shoulder.armored) {
            expect(fixture.instance.query().criticalHits(shoulder.id, 'preview')).toBe(1);
        } else {
            expect(fixture.instance.query().locationCondition(arm.id, 'blown-off', 'preview')).toBe(1);
        }
    });

    it('previews and commits a blown-off leg alongside pending internal damage', () => {
        const fixture = createDirectMekRuntimeFixture();
        const leg = [...fixture.index.locations.values()].find(location => location.code === 'LL')!;
        const before = fixture.instance.query().remainingInternal(leg.id, 'committed');

        expect(fixture.instance.dispatch({
            type: 'damage-internal',


            locationId: leg.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-location-condition',


            locationId: leg.id,
            condition: 'blown-off',
            value: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().locationCondition(leg.id, 'blown-off', 'committed')).toBe(0);
        expect(fixture.instance.query().locationCondition(leg.id, 'blown-off', 'preview')).toBe(1);

        const committed = fixture.instance.dispatch({
            type: 'end-phase',


        });

        expect(committed.accepted).toBeTrue();
        expect(fixture.instance.query().locationCondition(leg.id, 'blown-off', 'committed')).toBe(1);
        expect(fixture.instance.query().remainingInternal(leg.id, 'committed')).toBe(before - 1);
    });

    it('resolves a pending charged Bombast critical explosion at phase end', () => {
        const fixture = createDirectBombastRuntimeFixture();
        const bombast = fixture.equipmentComponent('Test Bombast Laser');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(bombast.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;

        expect(fixture.instance.dispatch({
            type: 'set-bombast-laser-charge',


            componentId: bombast.id,
            state: BOMBAST_LASER_CHARGING_STATE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',


            policy: 'automatic',
        }).accepted).toBeTrue();

        const before = fixture.instance.query().remainingInternal(location.id);
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',


            locationId: location.id,
            results: criticalDice(slot.slotIndex),
            target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().remainingInternal(location.id)).toBe(before);
        expect(fixture.instance.dispatch({
            type: 'end-phase',


        }).accepted).toBeTrue();

        expect(fixture.instance.query().remainingInternal(location.id)).toBeLessThan(before);
        expect(fixture.instance.query().componentStatus(bombast.id)).toBe('destroyed');
    });

    it('cancels a pending charged Bombast explosion when the weapon fires', () => {
        const fixture = createDirectBombastRuntimeFixture();
        const bombast = fixture.equipmentComponent('Test Bombast Laser');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(bombast.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        expect(fixture.instance.dispatch({
            type: 'set-bombast-laser-charge',

            componentId: bombast.id, state: BOMBAST_LASER_CHARGING_STATE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',

            locationId: location.id, results: criticalDice(slot.slotIndex), target: 'pending',
        }).accepted).toBeTrue();

        const before = fixture.instance.query().remainingInternal(location.id);
        expect(fixture.instance.dispatch({
            type: 'fire-weapons',

            selections: [{ weaponId: bombast.id }], heatPolicy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();

        expect(fixture.instance.query().remainingInternal(location.id)).toBe(before);
        expect(fixture.instance.query().componentStatus(bombast.id)).toBe('destroyed');
    });

    it('cancels a pending charged Bombast explosion when the charge is discharged', () => {
        const fixture = createDirectBombastRuntimeFixture();
        const bombast = fixture.equipmentComponent('Test Bombast Laser');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(bombast.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        expect(fixture.instance.dispatch({
            type: 'set-bombast-laser-charge',

            componentId: bombast.id, state: BOMBAST_LASER_CHARGING_STATE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',

            locationId: location.id, results: criticalDice(slot.slotIndex), target: 'pending',
        }).accepted).toBeTrue();

        const before = fixture.instance.query().remainingInternal(location.id);
        expect(fixture.instance.dispatch({
            type: 'set-bombast-laser-charge',

            componentId: bombast.id, state: null,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();

        expect(fixture.instance.query().remainingInternal(location.id)).toBe(before);
        expect(fixture.instance.query().componentStatus(bombast.id)).toBe('destroyed');
    });

    it('resolves pending charged PPC and capacitor damage as one explosion', () => {
        const fixture = createDirectMekRuntimeFixture();
        const weapon = fixture.equipmentComponent('Test PPC');
        const capacitor = fixture.equipmentComponent('Test PPC Capacitor');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(weapon.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        expect(fixture.instance.dispatch({
            type: 'set-ppc-capacitor-charge',

            capacitorId: capacitor.id, weaponId: weapon.id, state: PPC_CAPACITOR_CHARGING_STATE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',
            policy: 'automatic',
        }).accepted).toBeTrue();

        const before = fixture.instance.query().remainingInternal(location.id);
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',

            locationId: location.id, results: criticalDice(slot.slotIndex), target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();

        expect(fixture.instance.query().remainingInternal(location.id)).toBeLessThan(before);
        expect(fixture.instance.query().componentStatus(weapon.id)).toBe('destroyed');
        expect(fixture.instance.query().componentStatus(capacitor.id)).toBe('destroyed');
    });

    it('cancels a pending PPC/capacitor explosion when the charge is discharged', () => {
        const fixture = createDirectMekRuntimeFixture();
        const weapon = fixture.equipmentComponent('Test PPC');
        const capacitor = fixture.equipmentComponent('Test PPC Capacitor');
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(weapon.id))!;
        const location = fixture.index.locations.get(slot.locationId)!;
        expect(fixture.instance.dispatch({
            type: 'set-ppc-capacitor-charge',

            capacitorId: capacitor.id, weaponId: weapon.id, state: PPC_CAPACITOR_CHARGING_STATE,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'apply-mek-critical-roll',

            locationId: location.id, results: criticalDice(slot.slotIndex), target: 'pending',
        }).accepted).toBeTrue();

        const before = fixture.instance.query().remainingInternal(location.id);
        expect(fixture.instance.dispatch({
            type: 'set-ppc-capacitor-charge',

            capacitorId: capacitor.id, weaponId: weapon.id, state: null,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();

        expect(fixture.instance.query().remainingInternal(location.id)).toBe(before);
        expect(fixture.instance.query().componentStatus(weapon.id)).toBe('destroyed');
        expect(fixture.instance.query().componentStatus(capacitor.id)).toBe('available');
    });
});

function criticalDice(slotIndex: number): readonly number[] {
    return slotIndex < 6 ? [1, slotIndex + 1] : [4, slotIndex - 5];
}

function criticalExplosionDamage(fixture: DirectMekRuntimeFixture, equipmentId: string): number | undefined {
    const component = fixture.equipmentComponent(equipmentId);
    const plan = criticalRollPlan(fixture, component.id);
    return plan.kind === 'applied' ? plan.explosion?.rawDamage : undefined;
}

function criticalRollPlan(fixture: DirectMekRuntimeFixture, componentId: ComponentId) {
    const slot = slotForComponent(fixture, componentId);
    const location = fixture.index.locations.get(slot.locationId)!;
    return projectMekCriticalRollV2(
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        fixture.instance.query(),
        location.id,
        criticalDice(slot.slotIndex),
        'committed',
    );
}

function slotForComponent(fixture: DirectMekRuntimeFixture, componentId: ComponentId) {
    return [...fixture.index.slots.values()].find(candidate =>
        candidate.componentIds.includes(componentId))!;
}

function setCommittedComponentStatus(
    fixture: DirectMekRuntimeFixture,
    componentId: ComponentId,
    status: 'available' | 'disabled' | 'destroyed',
    commandId: string,
): boolean {
    return fixture.instance.dispatch({
        type: 'set-component-status',


        componentId,
        status,
        target: 'committed',
    }).accepted;
}
