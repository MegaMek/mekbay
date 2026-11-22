// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { CBTForce } from '../models/cbt-force.model';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import { MountedArmor } from '../models/entity/components/armor';
import type { LocationId } from '../models/entity/entity-identifiers';
import { TestAeroSpaceFighterEntity, TestProtoMekEntity, TestTankEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../models/entity/testing/test-mounted-equipment';
import type { ArmorType } from '../models/entity/types';
import { AmmoEquipment, ArmorEquipment, WeaponEquipment } from '../models/equipment.model';
import { aeroCriticalType } from '../models/rules/aero-critical-rules';
import { systemDamageId } from '../models/rules/system-damage-rules';
import { createNonMekUnit } from '../models/runtime/cbt-non-mek-unit';
import type { CBTUnitCommand } from '../models/runtime/unit-command';
import { componentIdForMount } from '../models/runtime/unit-runtime-index';
import { CBTAutomationCheckService, resolveAutomationChecksAutomatically } from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { CBTAutomationService } from './cbt-automation.service';
import { DirectNonMekAutomationService, type NonMekDamageGroup } from './direct-non-mek-automation.service';
import { OptionsService } from './options.service';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f2');

describe('NonMekCriticalAutomationService', () => {
    let mode: 'yes' | 'no' | 'ask';
    let service: DirectNonMekAutomationService;

    beforeEach(() => {
        mode = 'yes';
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: CBTAutomationService,
                    useValue: { resolve: async (_key: string, events: readonly { id: string }[]) => new Set(events.map(event => event.id)) },
                },
                {
                    provide: CBTAutomationCheckService,
                    useValue: { resolve: async (_key: string, checks: Parameters<typeof resolveAutomationChecksAutomatically>[0]) =>
                        resolveAutomationChecksAutomatically(checks) },
                },
                { provide: CBTAutomationToastService, useValue: { show: () => undefined } },
                {
                    provide: OptionsService,
                    useValue: {
                        cbtAutomationMode: () => mode,
                        options: () => ({ displayUnitNameFormat: 'innerSphereClan' }),
                    },
                },
            ],
        });
        service = TestBed.inject(DirectNonMekAutomationService);
    });

    /** A 20-ton tank with 10 points of armor on each location; dice come from `rolls` (1–6 each). */
    function tank(withAmmo = false, withAutocannon = false, armorType?: ArmorType, ruleset: CBTRuleset = 'core-2026') {
        const ammo = new AmmoEquipment({ id: 'Ammo_AC_5_Critical_Test', name: 'AC/5 Ammo', type: 'ammo',
            stats: { explosive: true }, ammo: { type: 'AC', rackSize: 5, shots: 20, damagePerShot: 1 } });
        // Catalogued explosive with an explosion damage, as the shipped AC/5 is, though no autocannon explodes
        const autocannon = new WeaponEquipment({ id: 'Critical_Test_AC5', name: 'AC/5', type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'], stats: { explosive: true, criticalSlots: 4 },
            weapon: { ammoType: 'AC', rackSize: 5, damage: '5', ranges: [3, 6, 12], explosionDamage: 5 } });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo, [autocannon.id]: autocannon }));
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        if (armorType) {
            entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: armorType, name: armorType, type: 'armor', armor: { type: armorType } }) }));
        }
        for (const location of entity.locationOrder) entity.setArmorValue(location, 'front', 10);
        const ammoId = withAmmo ? componentIdForMount(addTestEquipment(entity, ammo, { location: 'Rear', shotsCount: 2 })) : null;
        const acId = withAutocannon ? componentIdForMount(addTestEquipment(entity, autocannon, { location: 'Rear' })) : null;
        const runtime = createNonMekUnit(entity, { instanceId: 'critical-tank', uuid: UUID,
            scenario: { id: 'megamek', ruleset, options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const force = { getUnitSnapshot: () => ({ instanceId: runtime.instanceId, entity,
            index: runtime.getIndex(), uuid: UUID, ruleset: runtime.ruleset(), crewAssignment: runtime.getCrewAssignment(),
            editContext: { owner: runtime, state: runtime.snapshot() }, state: runtime.snapshot(), query: runtime.query(),
        }) } as unknown as CBTForce;
        const location = (code: string) => [...runtime.getIndex().locations.values()].find(row => row.code === code)!.id;
        const apply = (groups: readonly NonMekDamageGroup[], target: 'committed' | 'pending' = 'committed') =>
            service.applyWeaponHits(force, runtime.instanceId, groups, target,
                async (command: CBTUnitCommand) => runtime.dispatch(command));
        const hits = (id: ReturnType<typeof systemDamageId>) => runtime.snapshot().damageTracks.get(id)?.hits ?? 0;
        return { runtime, location, apply, hits, ammoId, acId };
    }

    /** A 5-ton ProtoMech with `armor` on the left arm, a torso laser filling die faces 1-2 of torso critical weapon rolls. */
    function protoMek(autocannon = false, armor = 0, ruleset: CBTRuleset = 'core-2026', torsoArmor = 0) {
        const laser = autocannon
            ? new WeaponEquipment({ id: 'Critical_Test_PAC', name: 'ProtoMech AC/2', type: 'weapon',
                flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'], weapon: { ammoType: 'PAC', rackSize: 2, damage: '2', ranges: [4, 8, 12] } })
            : new WeaponEquipment({ id: 'Critical_Test_Laser', name: 'ER Small Laser', type: 'weapon',
                weapon: { damage: '5', ranges: [2, 4, 5] } });
        const entity = new TestProtoMekEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
        entity.uuid.set(UUID);
        entity.setTonnage(5);
        entity.setArmorValue('Left Arm', 'front', armor);
        entity.setArmorValue('Torso', 'front', torsoArmor);
        const laserId = componentIdForMount(addTestEquipment(entity, laser, { location: 'Torso' }));
        const runtime = createNonMekUnit(entity, { instanceId: 'critical-protomek', uuid: UUID,
            scenario: { id: 'megamek', ruleset, options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const force = { getUnitSnapshot: () => ({ instanceId: runtime.instanceId, entity,
            index: runtime.getIndex(), uuid: UUID, ruleset: runtime.ruleset(), crewAssignment: runtime.getCrewAssignment(),
            editContext: { owner: runtime, state: runtime.snapshot() }, state: runtime.snapshot(), query: runtime.query(),
        }) } as unknown as CBTForce;
        const location = (code: string) => [...runtime.getIndex().locations.values()].find(row => row.code === code)!.id;
        const apply = (groups: readonly NonMekDamageGroup[]) => service.applyWeaponHits(force, runtime.instanceId, groups,
            'committed', async (command: CBTUnitCommand) => runtime.dispatch(command));
        const hits = (id: ReturnType<typeof systemDamageId>) => runtime.snapshot().damageTracks.get(id)?.hits ?? 0;
        const pilot = () => runtime.query().crewState(runtime.getCrewAssignment().positions[0]!.positionId);
        return { runtime, location, apply, hits, pilot, laserId };
    }

    /** A fighter with 20 points of nose armor (Damage Threshold 2) and SI 10, and a nose Gauss rifle if asked. */
    function fighter(withGauss = false, ruleset: CBTRuleset = 'core-2026') {
        const gauss = new WeaponEquipment({ id: 'Critical_Test_Gauss', name: 'Gauss Rifle', type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'], stats: { explosive: true, criticalSlots: 7 },
            weapon: { ammoType: 'GAUSS', rackSize: 15, damage: '15', ranges: [7, 15, 22], explosionDamage: 20 } });
        const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({ [gauss.id]: gauss }));
        entity.uuid.set(UUID);
        entity.structuralIntegrity.set(10);
        entity.setArmorValue('Nose', 'front', 20);
        const gaussId = withGauss ? componentIdForMount(addTestEquipment(entity, gauss, { location: 'Nose' })) : null;
        const runtime = createNonMekUnit(entity, { instanceId: 'critical-fighter', uuid: UUID,
            scenario: { id: 'megamek', ruleset, options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const force = { getUnitSnapshot: () => ({ instanceId: runtime.instanceId, entity,
            index: runtime.getIndex(), uuid: UUID, ruleset: runtime.ruleset(), crewAssignment: runtime.getCrewAssignment(),
            editContext: { owner: runtime, state: runtime.snapshot() }, state: runtime.snapshot(), query: runtime.query(),
        }) } as unknown as CBTForce;
        const location = (code: string) => [...runtime.getIndex().locations.values()].find(row => row.code === code)!.id;
        const apply = (groups: readonly NonMekDamageGroup[]) => service.applyWeaponHits(force, runtime.instanceId, groups,
            'committed', async (command: CBTUnitCommand) => runtime.dispatch(command));
        const hits = (id: ReturnType<typeof systemDamageId>) => runtime.snapshot().damageTracks.get(id)?.hits ?? 0;
        return { entity, runtime, location, apply, hits, gaussId };
    }

    function rolls(...dice: number[]): void {
        const random = jasmine.isSpy(Math.random) ? Math.random as jasmine.Spy : spyOn(Math, 'random');
        random.calls.reset();
        random.and.returnValues(...dice.map(die => (die - 0.5) / 6));
    }

    const group = (locationId: LocationId, damage: number, overrides: Partial<NonMekDamageGroup> = {}): NonMekDamageGroup => ({
        locationId, damage, arc: 'front', effects: [], source: { kind: 'weapon', types: ['DE'] }, ...overrides,
    });

    it('rolls a critical for internal structure damage, moving down past results that cannot apply', async () => {
        const unit = tank();
        // 7 on the front column: no weapons for a malfunction or a stabilizer, so the sensors take the hit.
        rolls(3, 4);
        expect(await unit.apply([group(unit.location('Front'), 11)])).toBeTrue();
        expect(unit.runtime.query().remainingInternal(unit.location('Front'))).toBeLessThan(
            unit.runtime.getIndex().locations.get(unit.location('Front'))!.internalPoints);
        expect(unit.hits(systemDamageId('sensors', 1))).toBe(1);
    });

    it('rolls for the hit-location critical even when armor holds, and skips everything when automation is off', async () => {
        const unit = tank();
        rolls(5, 5);
        expect(await unit.apply([group(unit.location('Front'), 2, { effects: ['critical'] })])).toBeTrue();
        expect(unit.hits(systemDamageId('commander'))).toBe(1);
        expect(unit.runtime.query().crewState(unit.runtime.getCrewAssignment().positions[0]!.positionId).unconscious).toBeTrue();

        mode = 'no';
        expect(await unit.apply([group(unit.location('Front'), 2, { effects: ['critical'] })])).toBeTrue();
        expect(unit.hits(systemDamageId('commander'))).toBe(1);
    });

    it('applies ablation and hardened armor to vehicle critical checks by ruleset and armor-piercing ammo', async () => {
        // 5 + 5 = 10 hits the commander; 8 moves down past the stabilizer to the sensors. A hit-location 2 is a
        // through-armor check; an 8 or 12 is another critical. Total Warfare: ablation gives the 2 -2 (IO:AE p.80),
        // hardened every hit-location check -2 even against armor-piercing rounds, never the check for structure damage
        // (TO:AUE p.93). Core: ablation blocks the 2,
        // hardened gives -2 to the 2 only (Core p.91, errata v0.2), and armor-piercing rounds strip both (Core p.191).
        const ap = { kind: 'weapon', types: ['DB'], ammo: 'armor-piercing' } as const;
        const tac = ['critical', 'through-armor'] as const;
        const cases = [
            ['ANTI_PENETRATIVE_ABLATION', 'total-warfare', 2, tac, undefined, [0, 1]],
            ['ANTI_PENETRATIVE_ABLATION', 'total-warfare', 10, tac, undefined, [1, 0]],
            ['ANTI_PENETRATIVE_ABLATION', 'total-warfare', 2, ['critical'], undefined, [1, 0]],
            ['HARDENED', 'total-warfare', 2, tac, ap, [0, 1]],
            ['HARDENED', 'total-warfare', 2, ['critical'], undefined, [0, 1]],
            ['HARDENED', 'total-warfare', 21, [], undefined, [1, 0]],
            ['HARDENED', 'core-2026', 2, tac, undefined, [0, 1]],
            ['HARDENED', 'core-2026', 2, ['critical'], undefined, [1, 0]],
            ['HARDENED', 'core-2026', 21, [], undefined, [1, 0]],
            ['HARDENED', 'core-2026', 2, tac, ap, [1, 0]],
            ['ANTI_PENETRATIVE_ABLATION', 'core-2026', 2, tac, undefined, [0, 0]],
            ['ANTI_PENETRATIVE_ABLATION', 'core-2026', 10, tac, undefined, [0, 0]],
            ['ANTI_PENETRATIVE_ABLATION', 'core-2026', 2, ['critical'], undefined, [1, 0]],
            ['ANTI_PENETRATIVE_ABLATION', 'core-2026', 2, tac, ap, [1, 0]],
        ] as const;
        for (const [armor, ruleset, damage, effects, source, expected] of cases) {
            const unit = tank(false, false, armor, ruleset);
            rolls(5, 5);
            expect(await unit.apply([group(unit.location('Front'), damage, { effects, ...(source ? { source } : {}) })]))
                .toBeTrue();
            expect([unit.hits(systemDamageId('commander')), unit.hits(systemDamageId('sensors', 1))])
                .withContext(`${armor} ${ruleset} ${damage}${source ? ' armor-piercing' : ''}`).toEqual([...expected]);
        }
    });

    it('rolls an armor-piercing vehicle critical for a hit that damages only armor, and none past the armor', async () => {
        const armorPiercing = { kind: 'weapon', types: ['DB'], ammo: 'armor-piercing', rackSize: 5 } as const;
        // 6 + 6 = 12 on the front column: TW -3 makes 9, the sensors; Core -2 makes 10, the commander (TW p.140, Core p.191).
        for (const [ruleset, expected] of [['total-warfare', [0, 1]], ['core-2026', [1, 0]]] as const) {
            const unit = tank(false, false, undefined, ruleset);
            rolls(6, 6);
            expect(await unit.apply([group(unit.location('Front'), 5, { source: armorPiercing })])).toBeTrue();
            expect([unit.hits(systemDamageId('commander')), unit.hits(systemDamageId('sensors', 1))])
                .withContext(ruleset).toEqual([...expected]);
        }
        // Damage past the armor rolls only the internal structure check: one 2D6, 3 + 4 moving down to the sensors.
        const unit = tank(false, false, undefined, 'total-warfare');
        rolls(3, 4);
        expect(await unit.apply([group(unit.location('Front'), 11, { source: armorPiercing })])).toBeTrue();
        expect(unit.hits(systemDamageId('sensors', 1))).toBe(1);
        expect((Math.random as jasmine.Spy).calls.count()).toBe(2);
    });

    it('rolls a ProtoMech armor-piercing check on the Determining Critical Hits Table', async () => {
        const unit = protoMek(false, 3);
        // 5 + 5 = 10, less 2 for a Core AC/5: 8 crosses off one box of the arm.
        rolls(5, 5);
        expect(await unit.apply([group(unit.location('Left Arm'), 3,
            { source: { kind: 'weapon', types: ['DB'], ammo: 'armor-piercing', rackSize: 5 } })])).toBeTrue();
        expect(unit.hits(systemDamageId('left-arm', 1))).toBe(1);
        expect(unit.hits(systemDamageId('left-arm', 2))).toBe(0);
    });

    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        it(`checks the ProtoMech torso armor a tandem-charge SRM hits through a missing arm under ${ruleset}`, async () => {
            const source = { kind: 'weapon', types: ['M'], ammo: 'tandem-charge' } as const;
            const unit = protoMek(false, 3, ruleset, 5);
            const arm = unit.location('Left Arm');
            const torso = unit.location('Torso');
            const torsoFace = [...unit.runtime.getIndex().armorFaces.values()].find(face => face.locationId === torso)!;
            expect(unit.runtime.dispatch({ type: 'damage-internal', locationId: arm,
                amount: unit.runtime.query().remainingInternal(arm), target: 'committed' }).accepted).toBeTrue();

            rolls(4, 5); // 9 − 2 = 7. The roll is made but does not mark a box.
            expect(await unit.apply([group(arm, 2, { source })])).toBeTrue();
            expect(unit.runtime.query().remainingArmor(torsoFace.id)).toBe(3);
            expect((Math.random as jasmine.Spy).calls.count()).toBe(2);
            expect(unit.hits(systemDamageId('torso', 1))).toBe(0);

            rolls(5, 5, 1, 6, 6); // 10 − 2 = 8. Apply the one critical to the torso.
            expect(await unit.apply([group(torso, 2, { source, transferred: true })])).toBeTrue();
            expect(unit.runtime.query().remainingArmor(torsoFace.id)).toBe(1);
            expect(unit.hits(systemDamageId('torso', 1))).toBe(1);
            expect(unit.hits(systemDamageId('torso', 2))).toBe(0);
        });
        it(`applies the AP autocannon transfer rule when the hit table already redirected a missing ProtoMech arm under ${ruleset}`, async () => {
            const unit = protoMek(false, 0, ruleset, 5);
            const source = { kind: 'weapon', types: ['DB'], ammo: 'armor-piercing', rackSize: 5 } as const;
            rolls(5, 4);
            expect(await unit.apply([group(unit.location('Torso'), 2, { source, transferred: true })])).toBeTrue();
            expect(Math.random).toHaveBeenCalledTimes(ruleset === 'core-2026' ? 2 : 0);
        });
    }

    it('does not start a second tandem-charge check where damage spills out of a newly destroyed arm', async () => {
        const unit = protoMek(false, 0, 'total-warfare', 5);
        const arm = unit.location('Left Arm');
        rolls(6, 6, 6, 6); // Crew injury from losing the arm can require its own check.
        expect(await unit.apply([group(arm, unit.runtime.query().remainingInternal(arm) + 1,
            { source: { kind: 'weapon', types: ['M'], ammo: 'tandem-charge' } })])).toBeTrue();
        expect(unit.runtime.query().remainingInternal(arm)).toBe(0);
        expect(unit.hits(systemDamageId('torso', 1))).toBe(0);
    });

    it('makes the tandem-charge armor check on a tank and resolves a standard SRM hit on a fighter', async () => {
        const source = { kind: 'weapon', types: ['M'], ammo: 'tandem-charge' } as const;
        const vehicle = tank(false, false, undefined, 'total-warfare');
        rolls(6, 6); // Front column: 12 − 2 = 10 (commander).
        expect(await vehicle.apply([group(vehicle.location('Front'), 2, { source })])).toBeTrue();
        expect(vehicle.hits(systemDamageId('commander'))).toBe(1);

        const aero = fighter();
        rolls(6, 6);
        expect(await aero.apply([group(aero.location('Nose'), 2, { source, aeroCritical: 'avionics' })])).toBeTrue();
        expect((Math.random as jasmine.Spy).calls.count()).toBe(0);
    });

    it('adds a modified fighter AP check for armor-only damage under Core', async () => {
        const source = { kind: 'weapon', types: ['DB'], ammo: 'armor-piercing', rackSize: 2 } as const;
        for (const ruleset of ['core-2026', 'total-warfare'] as const) {
            const unit = fighter(false, ruleset);
            const nose = unit.location('Nose');
            const hit = (damage: number) => group(nose, damage, { source, aeroCritical: 'avionics' });
            // Below or at the damage threshold, only Core rolls. The AC/2 needs 11 to score an 8.
            rolls(5, 5);
            expect(await unit.apply([hit(2)])).toBeTrue();
            expect(Math.random).toHaveBeenCalledTimes(ruleset === 'core-2026' ? 2 : 0);
            expect(unit.hits(systemDamageId('avionics', 1))).toBe(0);
            rolls(5, 6);
            expect(await unit.apply([hit(2)])).toBeTrue();
            expect(unit.hits(systemDamageId('avionics', 1))).toBe(ruleset === 'core-2026' ? 1 : 0);
            // The AC/5 exceeds the threshold. The threshold roll succeeds and the separate AP roll (9 - 2) misses.
            rolls(4, 4, 5, 4);
            expect(await unit.apply([group(nose, 5,
                { source: { ...source, rackSize: 5 }, aeroCritical: 'avionics' })])).toBeTrue();
            expect(Math.random).toHaveBeenCalledTimes(ruleset === 'core-2026' ? 4 : 2);
            expect(unit.hits(systemDamageId('avionics', ruleset === 'core-2026' ? 2 : 1))).toBe(1);
            // Eleven points of armor remain. Damage that reaches SI gives only the threshold and SI checks.
            rolls(3, 4, 3, 4);
            expect(await unit.apply([hit(13)])).toBeTrue();
            expect(Math.random).toHaveBeenCalledTimes(4);
        }
    });

    for (const target of ['committed', 'pending'] as const) {
        it(`destroys a Core autocannon on a second ${target} hit later in the same batch`, async () => {
            const unit = tank(false, true);
            // 11 on the rear column without ammunition: Weapon Destroyed; each 1D6 then picks the only weapon
            rolls(5, 6, 1, 5, 6, 1);
            const rear = unit.location('Rear');
            const perspective = target === 'pending' ? 'preview' : 'committed';
            expect(await unit.apply([group(rear, 2, { effects: ['critical'] })], target)).toBeTrue();
            // Core pp.92, 183: the first is only noted
            expect(unit.runtime.query().componentStatus(unit.acId!, perspective)).toBe('available');
            rolls(5, 6, 1, 5, 6, 1);
            const batch = tank(false, true);
            const batchRear = batch.location('Rear');
            expect(await batch.apply([
                group(batchRear, 2, { effects: ['critical'] }),
                group(batchRear, 2, { effects: ['critical'] }),
            ], target)).toBeTrue();
            expect(batch.runtime.query().componentStatus(batch.acId!, perspective)).toBe('destroyed');
            // A standard autocannon is not explosive (Core p.183, "Type: DB, S"): the destroyed gun deals no damage
            expect(batch.runtime.query().remainingInternal(batchRear, perspective))
                .toBe(batch.runtime.getIndex().locations.get(batchRear)!.internalPoints);
        });
    }

    it('explodes all ammunition into the struck location', async () => {
        const unit = tank(true);
        // 11 on the rear column: Ammunition, 2 shots × 5 damage into the rear structure.
        rolls(5, 6);
        const rear = unit.location('Rear');
        const before = unit.runtime.query().remainingInternal(rear);
        expect(await unit.apply([group(rear, 2, { effects: ['critical'] })])).toBeTrue();
        expect(unit.runtime.query().componentStatus(unit.ammoId!)).toBe('destroyed');
        expect(unit.runtime.query().remainingInternal(rear)).toBe(Math.max(0, before - 10));
    });

    it('rolls motive damage with the direction and motive modifiers', async () => {
        const unit = tank();
        // 3 + 3 from the side (+2) on tracks = 8: moderate damage.
        rolls(3, 3);
        expect(await unit.apply([group(unit.location('Left'), 2, { arc: 'left', effects: ['motive'] })])).toBeTrue();
        expect(unit.hits(systemDamageId('motive', 2))).toBe(1);
    });

    it('marks ProtoMech critical boxes, destroying the arm on its second box and wounding the pilot on shaded boxes', async () => {
        const unit = protoMek();
        // 10: two critical hits; the arm's second (shaded) box destroys it and wounds the pilot. Then a consciousness roll.
        rolls(5, 5, 6, 6);
        expect(await unit.apply([group(unit.location('Left Arm'), 1)])).toBeTrue();
        expect(unit.hits(systemDamageId('left-arm', 1))).toBe(1);
        expect(unit.hits(systemDamageId('left-arm', 2))).toBe(1);
        expect(unit.runtime.query().remainingInternal(unit.location('Left Arm'))).toBe(0);
        expect(unit.pilot().wounds).toBe(1);
    });

    it('rolls for a torso weapon on a ProtoMech torso critical', async () => {
        const unit = protoMek();
        // 8: one critical hit; torso weapon roll 1 destroys the laser; the shaded box wounds the pilot.
        rolls(4, 4, 1, 6, 6);
        expect(await unit.apply([group(unit.location('Torso'), 1)])).toBeTrue();
        expect(unit.hits(systemDamageId('torso', 1))).toBe(1);
        expect(unit.runtime.query().componentStatus(unit.laserId)).toBe('destroyed');
        expect(unit.pilot().wounds).toBe(1);
    });

    it('leaves a Core autocannon working on its first torso weapon critical and destroys it on the second', async () => {
        const unit = protoMek(true);
        rolls(4, 4, 1, 6, 6);
        expect(await unit.apply([group(unit.location('Torso'), 1)])).toBeTrue();
        // Core pp.92, 183: the first critical hit to an autocannon is noted and the gun keeps working
        expect(unit.runtime.query().componentStatus(unit.laserId)).toBe('available');
        expect(unit.runtime.snapshot().components.get(unit.laserId)?.autocannonHit).toBeTrue();
        expect(unit.runtime.dispatch({ type: 'set-system-damage-level', system: 'torso', level: 0, target: 'committed',
            timestamp: 1 }).accepted).toBeTrue();
        rolls(4, 4, 1, 6, 6);
        expect(await unit.apply([group(unit.location('Torso'), 1)])).toBeTrue();
        expect(unit.runtime.query().componentStatus(unit.laserId)).toBe('destroyed');
    });

    it('applies an exploding aerospace weapon as an ammunition explosion of its location', async () => {
        const unit = fighter(true);
        // 4 + 4 = 8 destroys the only weapon, which explodes: Core 2 per slot is 14, a tenth of it to the SI (TW pp.161,
        // 240), and the pilot takes 1 hit (TW p.41), then rolls consciousness
        rolls(4, 4, 1, 6, 6);
        expect(await unit.apply([group(unit.location('Nose'), 5, { aeroCritical: 'weapon' })])).toBeTrue();
        expect(unit.runtime.query().componentStatus(unit.gaussId!)).toBe('destroyed');
        const si = [...unit.runtime.getIndex().locations.values()].find(location => location.code === 'SI')!;
        expect(unit.runtime.query().remainingInternal(si.id)).toBe(si.internalPoints - 1);
        expect(unit.runtime.query().crewState(unit.runtime.getCrewAssignment().positions[0]!.positionId).wounds).toBe(1);
    });

    it('reads the critical an aerospace hit-location roll threatens', () => {
        const unit = fighter();
        expect(aeroCriticalType(unit.entity, 'front', 6)).toBe('avionics');
        expect(aeroCriticalType(unit.entity, 'rear', 4)).toBe('fuel');
        expect(aeroCriticalType(unit.entity, 'left', 8)).toBe('bomb');
    });

    it('rolls an aerospace critical for a hit over the Damage Threshold, and again for a lucky natural 12', async () => {
        const unit = fighter();
        const nose = unit.location('Nose');
        // 5 damage exceeds the threshold of 2: 4 + 4 = 8 hits the avionics.
        rolls(4, 4);
        expect(await unit.apply([group(nose, 5, { aeroCritical: 'avionics' })])).toBeTrue();
        expect(unit.hits(systemDamageId('avionics', 1))).toBe(1);
        // 2 damage does not exceed the threshold, but a lucky hit still rolls: 7 misses.
        rolls(3, 4);
        expect(await unit.apply([group(nose, 2, { aeroCritical: 'avionics', luckyHit: true })])).toBeTrue();
        expect(unit.hits(systemDamageId('avionics', 2))).toBe(0);
        expect(Math.random).toHaveBeenCalledTimes(2);
    });
});
