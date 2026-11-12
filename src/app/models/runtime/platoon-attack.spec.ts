// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { inventoryTargetRangeSelection } from '../../utils/inventory-target-number.util';
import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import { asComponentId } from '../entity/entity-identifiers';
import { TestInfantryEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { WeaponEquipment, type InfantryWeaponEquipment } from '../equipment.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import { platoonAttack } from '../rules/conventional-infantry-combat-rules';
import { gameRulesFor, TW_GAME_RULES, type CBTGameRules } from '../rules/game-rules';
import { platoonAttackProfile, resolveWeaponAttack } from '../rules/weapon-attack-resolution';
import { FLAMER_HEAT_MODE } from '../flamer-mode.model';
import { historyTargetLabel } from './cbt-force-runtime-history';
import { projectNonMekEquipmentInteractions, selectNonMekEquipmentChoice } from './cbt-equipment-interactions';
import { asEncounterTargetId, type TargetRegistrySnapshot } from './encounter-runtime';
import { projectNonMekEquipmentPanel } from './non-mek-equipment-panel';
import { nonMekComponentModes } from './non-mek-unit-instance';
import type { InstanceBaselineRef } from './runtime-state';
import { createNonMekRuntimeForTest } from './testing/unit-runtime-owner-fixture';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e9');

function infantryWeapon(id: string, damage: number, range: number, flags: EquipmentFlag[] = []): InfantryWeaponEquipment {
    const weapon = new WeaponEquipment({
        id, name: id, type: 'weapon', flags: ['F_INFANTRY', ...flags],
        weapon: { ammoType: 'INFANTRY' }, infantry: { damage, range },
    });
    if (!weapon.isInfantryWeapon()) throw new Error(`${id} is not an infantry weapon`);
    return weapon;
}

describe('conventional platoon attacks', () => {
    const srm = infantryWeapon('InfantryStandardSRM', 1.14, 2, ['F_SRM']);
    const law = infantryWeapon('Rocket Launcher (LAW)', 0.53, 2, ['F_INF_DISPOSABLE']);
    const baseline: InstanceBaselineRef = Object.freeze({
        entity: UUID,
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const, initializerRevision: 1, profileId: 'pristine-non-mek-v1',
        }),
    });
    const registry: TargetRegistrySnapshot = Object.freeze({
        revision: 0,
        targets: Object.freeze([Object.freeze({
            id: asEncounterTargetId('target:platoon'), letter: 'A', name: 'Target A', color: '#ff0000',
            source: 'manual' as const, readOnly: false,
        })]),
    });

    function platoon(inferno: boolean) {
        const entity = new TestInfantryEntity(createTestEquipmentRegistry({ [srm.id]: srm, [law.id]: law }));
        entity.uuid.set(UUID);
        entity.squadSize.set(7);
        entity.squadCount.set(4);
        entity.setPlatoonWeapon('primary', srm);
        entity.setPlatoonWeapon('disposable', law);
        entity.infernoSrmsDeclared.set(inferno);
        const runtime = createNonMekRuntimeForTest('unit:platoon-attack', baseline, entity, CORE_2026_RULESET);
        const mountId = (role: string) =>
            asComponentId(entity.equipment().find(mount => mount.platoonWeapon === role)!.mountId);
        const panel = () => projectNonMekEquipmentPanel(entity, runtime.getIndex(), CORE_2026_RULESET,
            runtime.snapshot(), runtime.query(), registry);
        const select = (role: string) => runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: {
                kind: 'set-component-selection',
                componentId: mountId(role),
                selection: { kind: 'target', targetId: registry.targets[0]!.id },
            },
        }, registry, false).accepted;
        const fire = () => runtime.dispatchSelectedWeaponFire(
            { type: 'fire-selected-weapons', heatPolicy: 'automatic' }, registry, false, false);
        return { entity, runtime, mountId, panel, select, fire };
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
        }, TW_GAME_RULES);
        // Roll 7 on the 28 column: 17 troopers hit, 17 x 0.6 = 10 damage.
        expect(resolveWeaponAttack(profile, [4, 4], [3, 4])).toEqual({
            hit: true, jammed: false, hits: 17, groups: [2, 2, 2, 2, 2], heat: 0
        });
        entity.infernoSrmsDeclared.set(true);
        const inferno = (partialCover: boolean, rules: CBTGameRules) => platoonAttackProfile({
            componentId: asComponentId('platoon'), name: 'Platoon', targetNumber: 7, types: [], partialCover,
            attack: platoonAttack(entity, 28),
        }, rules);
        expect(resolveWeaponAttack(inferno(false, TW_GAME_RULES), [4, 4], [3, 4]).groups).toEqual([1, 1, 1, 1, 1]);
        // Core infernos roll no hit location, so partial cover cannot stop them (Core p. 192).
        expect(inferno(true, TW_GAME_RULES).partialCover).toBeTrue();
        expect(inferno(true, gameRulesFor(CORE_2026_RULESET)).partialCover).toBeFalse();
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
        expect(nonMekComponentModes(entity, rifle, TOTAL_WARFARE_RULESET).modes).toEqual(['Damage', 'Heat']);
        expect(nonMekComponentModes(entity, flamer, TOTAL_WARFARE_RULESET).modes).toEqual([]);
        // Core flamers always deal both, so there is nothing to declare.
        expect(nonMekComponentModes(entity, rifle, CORE_2026_RULESET).modes).toEqual([]);

        const choices = projectNonMekEquipmentInteractions(unit, {}, false)
            .find(row => row.componentId === primary)!.choices;
        expect(choices.map(choice => [choice.groupLabel, choice.label, choice.active]))
            .toEqual([['Mode', 'Damage', true], ['Mode', 'Heat', false]]);
        // Enhanced Flamers deal both, so the platoon's flamer declares nothing.
        expect(projectNonMekEquipmentInteractions(unit, { enhancedFlamers: true }, false)
            .find(row => row.componentId === primary)).toBeUndefined();
        expect(selectNonMekEquipmentChoice(unit, choices[1]!.command, {}, {} as never)).toBeTrue();
        expect(unit.query().componentMode(primary)).toBe(FLAMER_HEAT_MODE);
        // The log names the attack, not only its primary weapon.
        expect(historyTargetLabel(unit, 'component', primary)).toBe('Rifle + Flamer');
    });
});
