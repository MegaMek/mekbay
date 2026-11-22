// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { inventoryTargetRangeSelection } from '../../utils/inventory-target-number.util';
import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import { asComponentId } from '../entity/entity-identifiers';
import { TestBattleArmorEntity, TestInfantryEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { addTestEquipment, addTestEquipmentWithFlags } from '../entity/testing/test-mounted-equipment';
import type { EntityMountedEquipment } from '../entity/types';
import { WeaponEquipment, type AmmoType, type InfantryWeaponEquipment } from '../equipment.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import { platoonAttack } from '../rules/conventional-infantry-combat-rules';
import { platoonAttackProfile, resolveWeaponAttack } from '../rules/weapon-attack-resolution';
import { FLAMER_HEAT_MODE } from '../flamer-mode.model';
import { historyTargetLabel } from './cbt-force-runtime-history';
import { projectNonMekEquipmentInteractions, selectNonMekEquipmentChoice } from './cbt-equipment-interactions';
import { asEncounterTargetId, type TargetRegistrySnapshot } from './encounter-runtime';
import { projectNonMekEquipmentPanel } from './non-mek-equipment-panel';
import { projectWeaponTargetPresentation, physicalAttackTargetNumber } from './equipment-panel';
import { physicalTargetIssue } from '../rules/physical-attack-rules';
import { physicalAttackProfile } from '../rules/weapon-attack-resolution';
import { nonMekComponentModes } from './non-mek-unit-instance';
import type { InstanceBaselineRef } from './runtime-state';
import { createNonMekRuntimeForTest } from './testing/unit-runtime-owner-fixture';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e9');

function infantryWeapon(
    id: string,
    damage: number,
    range: number,
    flags: EquipmentFlag[] = [],
    ammoType: AmmoType = 'INFANTRY',
): InfantryWeaponEquipment {
    const weapon = new WeaponEquipment({
        id, name: id, type: 'weapon', flags: ['F_INFANTRY', ...flags],
        weapon: { ammoType }, infantry: { damage, range },
    });
    if (!weapon.isInfantryWeapon()) throw new Error(`${id} is not an infantry weapon`);
    return weapon;
}

describe('conventional platoon attacks', () => {
    const srm = infantryWeapon('InfantryStandardSRM', 1.14, 2, ['F_SRM']);
    // Disposable weapons carry no ammunition in the equipment data.
    const law = infantryWeapon('Rocket Launcher (LAW)', 0.53, 2, ['F_INF_DISPOSABLE'], 'NA');
    const baseline: InstanceBaselineRef = Object.freeze({
        entity: UUID,
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            profileId: 'pristine-non-mek',
        }),
    });
    const registry: TargetRegistrySnapshot = Object.freeze({
        revision: 0,
        targets: Object.freeze([Object.freeze({
            id: asEncounterTargetId('target:platoon'), letter: 'A', name: 'Target A', color: '#ff0000',
            source: 'manual' as const, readOnly: false,
        })]),
    });

    /** A unit's runtime with its weapons found by `mountFor`, selected against Target A and fired. */
    function attacker<T extends BaseEntity>(entity: T, mountFor: (role: string) => EntityMountedEquipment | undefined) {
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest('unit:platoon-attack', baseline, entity, CORE_2026_RULESET);
        const mountId = (role: string) => asComponentId(mountFor(role)!.mountId);
        const panel = () => projectNonMekEquipmentPanel(entity, runtime.getIndex(), CORE_2026_RULESET,
            runtime.snapshot(), runtime.query(), registry, {});
        const select = (role: string) => runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: {
                kind: 'set-component-selection',
                componentId: mountId(role),
                selection: { kind: 'target', targetId: registry.targets[0]!.id },
            },
        }, registry, false).accepted;
        const fire = () => runtime.dispatchSelectedWeaponFire(
            { type: 'fire-selected-weapons' }, registry, false, false);
        const selectable = (role: string) => panel().components
            .find(row => row.componentId === mountId(role))!.weapon?.selectable;
        return { entity, runtime, mountId, panel, select, fire, selectable };
    }

    it('fires squad mounts with active suits and strikes separately with vibro-claws', () => {
        const entity = new TestBattleArmorEntity();
        entity.declaredWeightClass.set('Medium');
        entity.trooperCount.set(5);
        const laser = new WeaponEquipment({ id: 'BALaser', name: 'Laser', type: 'weapon',
            weapon: { damage: 5, ranges: [3, 6, 9] } });
        const gun = addTestEquipment(entity, laser, { location: 'Squad' });
        for (let i = 0; i < 2; i++) addTestEquipmentWithFlags(entity, ['F_VIBROCLAW', 'F_BATTLE_CLAW']);
        const test = attacker(entity, () => gun);
        const location = [...test.runtime.getIndex().locations.values()].find(loc => loc.code === 'Trooper 1')!;
        const claws = test.panel().physicalAttacks.find(action => action.kind === 'vibro-claw')!;
        expect(claws).toEqual(jasmine.objectContaining({ firingSuits: 5, gunnerySkill: test.panel().crew.gunnery,
            damageGroupSize: 2, reach: 'infantry-in-hex', selectable: true }));
        expect(test.runtime.dispatch({ type: 'set-internal-damage', locationId: location.id, damage: 1 }).accepted).toBeTrue();
        const weapon = test.panel().components.find(row => row.componentId === test.mountId('laser'))!.weapon!;
        expect(weapon.firingSuits).toBe(4);
        expect(weapon.attackerIsBattleArmor).toBeTrue();
        const row = test.panel().components.find(row => row.componentId === test.mountId('laser'))!;
        const target = { id: registry.targets[0].id, letter: 'A', name: 'BA', color: '#fff', unitType: 'battle-armor' as const,
            distance: 1, tnModifier: 1, tnCalculator: {} };
        const attack = { gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false,
            missingMovementModifier: false, attackModifierBreakdown: [], c3DegradationSource: 'none' as const, c3Available: false };
        const tn = (isBA: boolean) => projectWeaponTargetPresentation({ ...row,
            weapon: { ...weapon, attackerIsBattleArmor: isBA } }, target, attack, 'total-warfare').targetNumberText;
        expect(tn(true)).toBe('4');
        expect(tn(false)).toBe('5');
        expect(projectWeaponTargetPresentation(row, { ...target, tnCalculator: undefined }, attack, 'total-warfare').targetNumberText).toBe('4');
        expect(physicalTargetIssue('vibro-claw', claws.reach, { distance: 0, unitType: 'infantry',
            tnCalculator: { targetHexCover: 'heavy' } })).toBeNull();
        expect(physicalTargetIssue('vibro-claw', claws.reach, { distance: 1, unitType: 'infantry' })).toBe('out-of-range');
        expect(physicalAttackTargetNumber({ ...claws, gunnerySkill: 3 }, 6, attack,
            { tnModifier: 0, unitType: 'infantry' })).toBe(3);
        const profile = physicalAttackProfile({ name: 'Paired claws', kind: 'vibro-claw', damage: 2,
            firingSuits: claws.firingSuits, groupSize: claws.damageGroupSize, table: 'standard', partialCover: false, targetNumber: 4 });
        expect(resolveWeaponAttack(profile, [4, 4], [4, 5]).groups).toEqual([2, 2, 2, 2]);
    });

    it('blocks both anti-Mek attacks until the last IS body launcher is jettisoned, even when empty', () => {
        const entity = new TestBattleArmorEntity();
        entity.declaredWeightClass.set('Medium');
        entity.trooperCount.set(4);
        addTestEquipmentWithFlags(entity, 'F_BATTLE_CLAW');
        const srm = new WeaponEquipment({ id: 'BASRM2', name: 'SRM 2', type: 'weapon', flags: ['F_MISSILE'],
            weapon: { damage: 'cluster', rackSize: 2, ammoType: 'SRM', ranges: [3, 6, 9] } });
        const mount = addTestEquipment(entity, srm, { location: 'Squad', baMountLocation: 'Body' });
        const test = attacker(entity, () => mount);
        const canAttack = () => test.panel().physicalAttacks.filter(a => a.kind === 'swarm' || a.kind === 'leg-attack')
            .map(a => a.available);
        expect(canAttack()).toEqual([false, false]);
        expect(test.runtime.dispatch({ type: 'set-component-mode', componentId: test.mountId('srm'), mode: 'Jettisoned' }).accepted).toBeTrue();
        expect(canAttack()).toEqual([true, true]);
        expect(test.selectable('srm')).toBeFalse();
    });

    it('eliminating the last trooper blocks squad fire even if Infernos left its armor intact', () => {
        const entity = new TestBattleArmorEntity();
        entity.trooperCount.set(1);
        entity.setArmorValue('Squad', 'front', 5);
        const gun = addTestEquipment(entity, new WeaponEquipment({ id: 'Laser', name: 'Laser', type: 'weapon',
            weapon: { damage: 5, ranges: [3, 6, 9] } }), { location: 'Squad' });
        const test = attacker(entity, () => gun);
        expect(test.select('gun')).toBeTrue();
        const loc = [...test.runtime.getIndex().locations.values()].find(row => row.code === 'Trooper 1')!;
        test.runtime.dispatch({ type: 'set-internal-damage', locationId: loc.id, damage: 1 });
        expect(test.runtime.query().remainingArmor(loc.armorFaceIds[0], 'committed')).toBe(5);
        expect(test.runtime.query().destroyed()).toBeTrue();
        expect(test.selectable('gun')).toBeFalse();
        expect(test.fire().changed).toBeFalse();
    });

    it('uses the platoon weapon features when an attack is declared against an identified unit', () => {
        const declare = (flags: EquipmentFlag[], unitType: 'infantry' | 'mek-biped' | 'aero', airborne = false) => {
            const rifle = infantryWeapon('Infantry Rifle', 0.3, 2, flags);
            const entity = new TestInfantryEntity(createTestEquipmentRegistry({ [rifle.id]: rifle }));
            entity.squadSize.set(7);
            entity.squadCount.set(4);
            entity.setPlatoonWeapon('primary', rifle);
            const test = attacker(entity, role => entity.equipment().find(mount => mount.platoonWeapon === role));
            const target = { ...registry.targets[0], unitType, tnCalculator: { isAirborne: airborne } };
            return test.runtime.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                edit: { kind: 'set-component-selection', componentId: test.mountId('primary'),
                    selection: { kind: 'target', targetId: target.id } },
            }, { ...registry, targets: [target] }, false).changed;
        };
        expect(declare(['F_INF_NONPENETRATING'], 'mek-biped')).toBeFalse();
        expect(declare(['F_INF_NONPENETRATING'], 'infantry')).toBeTrue();
        expect(declare([], 'aero', true)).toBeFalse();
        expect(declare(['F_INF_AA'], 'aero', true)).toBeTrue();
        expect(declare([], 'aero')).toBeTrue();
    });

    function platoon(inferno: boolean) {
        const entity = new TestInfantryEntity(createTestEquipmentRegistry({ [srm.id]: srm, [law.id]: law }));
        entity.squadSize.set(7);
        entity.squadCount.set(4);
        entity.setPlatoonWeapon('primary', srm);
        entity.setPlatoonWeapon('disposable', law);
        entity.infernoSrmsDeclared.set(inferno);
        return attacker(entity, role => entity.equipment().find(mount => mount.platoonWeapon === role));
    }

    it('shows the platoon attack on the primary weapon row and the disposable weapon on its own row', () => {
        const test = platoon(true);
        const rows = test.panel().components;
        const primary = rows.find(row => row.componentId === test.mountId('primary'))!;
        const disposable = rows.find(row => row.componentId === test.mountId('disposable'))!;

        // Primary damage is capped at 0.6 a trooper: 28 x 0.6 = 17, fired as 8 inferno missiles.
        // The LAW deals 3 x 0.53 per trooper: 45.
        expect(primary.weapon?.platoon?.troopers).toBe(28);
        expect(primary.weapon?.damageText).toBe('8 Inferno');
        expect(primary.weapon?.ranges).toEqual([2, 4, 6]);
        expect(disposable.weapon?.damageText).toBe('45');
        expect(rows.filter(row => row.weapon?.platoon !== undefined).length).toBe(2);
    });

    it('fires the disposable weapon instead of the platoon attack, once', () => {
        const test = platoon(false);
        expect(test.select('primary')).toBeTrue();
        expect(test.select('disposable')).toBeTrue();
        const before = test.runtime.snapshot().stateRevision;
        test.fire();
        expect(test.runtime.snapshot().stateRevision).toBe(before);
        expect(test.runtime.query().componentStatus(test.mountId('disposable'), 'committed')).toBe('available');

        const single = platoon(false);
        expect(single.select('disposable')).toBeTrue();
        single.fire();
        expect(single.runtime.query().componentStatus(single.mountId('disposable'), 'committed')).toBe('destroyed');
    });

    it('fires the platoon attack or the disposable weapon in a turn, not one after the other', () => {
        const primaryFirst = platoon(false);
        expect(primaryFirst.select('primary')).toBeTrue();
        primaryFirst.fire();
        expect(primaryFirst.runtime.snapshot().turn.firedWeapons).toEqual([primaryFirst.mountId('primary')]);
        expect(primaryFirst.selectable('disposable')).toBeFalse();
        primaryFirst.select('disposable');
        const before = primaryFirst.runtime.snapshot().stateRevision;
        primaryFirst.fire();
        expect(primaryFirst.runtime.snapshot().stateRevision).toBe(before);
        expect(primaryFirst.runtime.query().componentStatus(primaryFirst.mountId('disposable'), 'committed'))
            .toBe('available');

        const disposableFirst = platoon(false);
        expect(disposableFirst.select('disposable')).toBeTrue();
        disposableFirst.fire();
        expect(disposableFirst.selectable('primary')).toBeFalse();

        // Spent and still selected, the disposable weapon leaves the next turn's platoon attack free.
        expect(disposableFirst.runtime.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
        expect(disposableFirst.selectable('primary')).toBeTrue();
    });

    it('greys out the weapons the selected ones rule out', () => {
        const test = platoon(false);
        expect(test.select('primary')).toBeTrue();
        expect(test.selectable('disposable')).toBeFalse();
        expect(test.selectable('primary')).toBeTrue();
    });

    it('keeps the disposable weapon for when the platoon is out of the water (TO:AuE p. 153)', () => {
        const test = platoon(false);
        expect(test.runtime.dispatch({ type: 'set-cover', cover: 'underwater-depth-1' }).accepted).toBeTrue();
        expect(test.selectable('disposable')).toBeFalse();
        expect(test.selectable('primary')).toBeTrue();
        test.select('disposable');
        test.fire();
        expect(test.runtime.query().componentStatus(test.mountId('disposable'), 'committed')).toBe('available');
        expect(test.runtime.dispatch({ type: 'set-cover', cover: null }).accepted).toBeTrue();
        expect(test.selectable('disposable')).toBeTrue();
    });

    it("fires battle armor's anti-personnel weapons as infantry, one a turn (TW p. 218)", () => {
        const rifle = infantryWeapon('InfantryAssaultRifle', 0.57, 1);
        const pistol = infantryWeapon('Laser Pistol', 0.2, 1);
        const entity = new TestBattleArmorEntity(createTestEquipmentRegistry({ [rifle.id]: rifle, [pistol.id]: pistol }));
        entity.trooperCount.set(4);
        const mounts = new Map([
            ['rifle', addTestEquipment(entity, rifle, { location: 'Squad' })],
            ['pistol', addTestEquipment(entity, pistol, { location: 'Trooper 1' })],
        ]);
        const test = attacker(entity, role => mounts.get(role));
        const row = (role: string) => test.panel().components.find(candidate => candidate.componentId === test.mountId(role))!;

        // The Cluster Hits Table is rolled on the suits carrying it: 0.57 x 4 suits = 2; the pistol on one suit only.
        expect(row('rifle').weapon?.platoon?.troopers).toBe(4);
        expect(row('rifle').weapon?.damageText).toBe('2');
        expect(row('pistol').weapon?.platoon?.troopers).toBe(1);
        // Both selected, neither fires.
        expect(test.select('rifle')).toBeTrue();
        expect(test.selectable('pistol')).toBeFalse();
        test.select('pistol');
        test.fire();
        expect(test.runtime.snapshot().turn.firedWeapons ?? []).toEqual([]);
        // The troopers carry the rifle's ammunition: it fires without a bin, and then the pistol can't this turn.
        expect(test.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-component-selection', componentId: test.mountId('pistol'), selection: null },
        }, registry, false).accepted).toBeTrue();
        test.fire();
        expect(test.runtime.snapshot().turn.firedWeapons).toEqual([test.mountId('rifle')]);
        expect(test.selectable('pistol')).toBeFalse();
    });

    it('keeps a disposable weapon that not every battle armor suit carries from firing', () => {
        const entity = new TestBattleArmorEntity(createTestEquipmentRegistry({ [law.id]: law }));
        entity.trooperCount.set(4);
        const mount = addTestEquipment(entity, law, { location: 'Trooper 1' });
        expect(attacker(entity, () => mount).selectable('law')).toBeFalse();
    });

    it("fires a battle armor squad's disposable weapon once, instead of its other weapons", () => {
        const rifle = infantryWeapon('Auto-Rifle', 0.52, 1);
        const entity = new TestBattleArmorEntity(createTestEquipmentRegistry({ [rifle.id]: rifle, [law.id]: law }));
        entity.trooperCount.set(4);
        const mounts = new Map([
            ['rifle', addTestEquipment(entity, rifle, { location: 'Squad' })],
            ['disposable', addTestEquipment(entity, law, { location: 'Squad' })],
        ]);
        const test = attacker(entity, role => mounts.get(role));

        // 3 x 0.53 for each of the 4 suits: 6.
        const row = test.panel().components.find(candidate => candidate.componentId === test.mountId('disposable'))!;
        expect(row.weapon?.platoon?.troopers).toBe(4);
        expect(row.weapon?.damageText).toBe('6');
        expect(test.select('disposable')).toBeTrue();
        test.fire();
        expect(test.runtime.query().componentStatus(test.mountId('disposable'), 'committed')).toBe('destroyed');
        expect(test.selectable('rifle')).toBeFalse();
    });

    it('reads the range modifier hex by hex', () => {
        const facts = platoonAttack(platoon(false).entity, 28);
        const at = (distance: number) => inventoryTargetRangeSelection({
            targetNumberFacts: {
                componentId: asComponentId('platoon'), physical: false, aerospaceWeapon: null,
                infantryRangeModifiers: facts.rangeModifiers,
            },
            display: { min: '—', short: '2', medium: '4', long: '6' },
            target: { distance, letter: 'A', tnModifier: 0 } as never,
        });
        // Range 2 infantry weapons: -2, 0, 0, +2, +2, +4, +4 by hex; a capped primary takes 1 less point blank.
        expect([0, 1, 3, 5, 6].map(distance => at(distance)?.rangeModifier)).toEqual([-3, 0, 2, 4, 4]);
        expect(at(7)?.outOfRange).toBeTrue();
    });

    it('rolls the Cluster Hits Table on troopers and deals their damage in 2-point groups', () => {
        const entity = platoon(false).entity;
        const profile = platoonAttackProfile({
            componentId: asComponentId('platoon'), name: 'Platoon', targetNumber: 7, types: [], partialCover: false,
            attack: platoonAttack(entity, 28),
        });
        // Roll 7 on the 28 column: 17 troopers hit, 17 x 0.6 = 10 damage.
        expect(resolveWeaponAttack(profile, [4, 4], [3, 4])).toEqual({
            hit: true, jammed: false, hits: 17, groups: [2, 2, 2, 2, 2], heat: 0
        });
        entity.infernoSrmsDeclared.set(true);
        const inferno = (partialCover: boolean) => platoonAttackProfile({
            componentId: asComponentId('platoon'), name: 'Platoon', targetNumber: 7, types: [], partialCover,
            attack: platoonAttack(entity, 28),
        });
        expect(resolveWeaponAttack(inferno(false), [4, 4], [3, 4]).groups).toEqual([1, 1, 1, 1, 1]);
        // Inferno missiles roll their locations in either ruleset, so partial cover can stop them (Xotl, Core forum
        // ruling, 19 Oct 2026)
        expect(inferno(true).partialCover).toBeTrue();
    });

    it('strikes a heat-only attack in 2-point groups, each rolling its own location (TW p. 215)', () => {
        const profile = platoonAttackProfile({
            componentId: asComponentId('platoon'), name: 'Platoon', targetNumber: 7, types: [], partialCover: false,
            attack: platoonAttack(platoon(false).entity, 28),
            heatWeapon: { weapon: { kind: 'heat-or-damage' }, mode: 'heat', ruleset: TOTAL_WARFARE_RULESET,
                target: { tracksHeat: true, fireResistant: false } },
        });
        // Roll 7 on the 28 column: 10 damage declared as 10 heat, in five groups.
        expect(resolveWeaponAttack(profile, [4, 4], [3, 4])).toEqual({
            hit: true, jammed: false, hits: 17, groups: [0, 0, 0, 0, 0], heat: 10,
        });
    });

    it('declares heat for the whole attack on its row when the secondary weapon is a flamer', () => {
        const rifle = infantryWeapon('Rifle', 0.25, 1);
        const flamer = infantryWeapon('Flamer', 0.35, 0, ['F_FLAMER']);
        const entity = new TestInfantryEntity(createTestEquipmentRegistry({ [rifle.id]: rifle, [flamer.id]: flamer }));
        entity.uuid.set(UUID);
        entity.squadSize.set(7);
        entity.squadCount.set(4);
        entity.setPlatoonWeapon('primary', rifle);
        entity.setPlatoonWeapon('secondary', flamer);
        entity.secondaryCount.set(2);
        const unit = createNonMekRuntimeForTest('unit:flamer-platoon', { ...baseline, ruleset: TOTAL_WARFARE_RULESET },
            entity, TOTAL_WARFARE_RULESET);
        const primary = asComponentId(entity.equipment().find(mount => mount.platoonWeapon === 'primary')!.mountId);

        expect(platoonAttack(entity, 28).heatOrDamageWeapon).toBe(flamer);
        expect(nonMekComponentModes(entity, entity.equipment().find(mount => mount.equipment === rifle), TOTAL_WARFARE_RULESET).modes).toEqual(['Damage', 'Heat']);
        expect(nonMekComponentModes(entity, entity.equipment().find(mount => mount.equipment === flamer), TOTAL_WARFARE_RULESET).modes).toEqual([]);
        // Core flamers always deal both, so there is nothing to declare.
        expect(nonMekComponentModes(entity, entity.equipment().find(mount => mount.equipment === rifle), CORE_2026_RULESET).modes).toEqual([]);

        const choices = projectNonMekEquipmentInteractions(unit, {}, false)
            .find(row => row.componentId === primary)!.choices;
        expect(choices.map(choice => [choice.groupLabel, choice.label, choice.active]))
            .toEqual([['Mode', 'Damage', true], ['Mode', 'Heat', false]]);
        // Enhanced Flamers deal both, so the platoon's flamer declares nothing.
        expect(projectNonMekEquipmentInteractions(unit, { optionalRules: { enhancedFlamers: true } }, false)
            .find(row => row.componentId === primary)).toBeUndefined();
        const rowLabel = (optionalRules = {}) => projectNonMekEquipmentPanel(entity, unit.getIndex(),
            TOTAL_WARFARE_RULESET, unit.snapshot(), unit.query(), registry, optionalRules)
            .components.find(row => row.componentId === primary)!.label;
        expect(rowLabel()).toBe('Rifle + Flamer');
        expect(selectNonMekEquipmentChoice(unit, choices[1]!.command, {}, {} as never)).toBeTrue();
        expect(unit.query().componentMode(primary)).toBe(FLAMER_HEAT_MODE);
        expect(rowLabel()).toBe('Rifle + Flamer (Heat)');
        expect(rowLabel({ enhancedFlamers: true })).toBe('Rifle + Flamer');
        // The log names the attack, not only its primary weapon.
        expect(historyTargetLabel(unit, 'component', primary)).toBe('Rifle + Flamer');
    });
});
