// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { CBTForce } from '../models/cbt-force.model';
import type { LocationId } from '../models/entity/entity-identifiers';
import { TestAeroSpaceFighterEntity, TestProtoMekEntity, TestTankEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
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
    function tank(withAmmo = false) {
        const ammo = new AmmoEquipment({ id: 'Ammo_AC_5_Critical_Test', name: 'AC/5 Ammo', type: 'ammo',
            stats: { explosive: true }, ammo: { type: 'AC', rackSize: 5, shots: 20, damagePerShot: 1 } });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo }));
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        for (const location of entity.locationOrder) entity.setArmorValue(location, 'front', 10);
        const ammoId = withAmmo ? componentIdForMount(addTestEquipment(entity, ammo, { location: 'Rear', shotsCount: 2 })) : null;
        const runtime = createNonMekUnit(entity, { instanceId: 'critical-tank', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const force = { getUnitSnapshot: () => ({ instanceId: runtime.instanceId, entity,
            index: runtime.getIndex(), uuid: UUID, ruleset: runtime.ruleset(), crewAssignment: runtime.getCrewAssignment(),
            editContext: { owner: runtime, state: runtime.snapshot() }, state: runtime.snapshot(), query: runtime.query(),
        }) } as unknown as CBTForce;
        const location = (code: string) => [...runtime.getIndex().locations.values()].find(row => row.code === code)!.id;
        const apply = (groups: readonly NonMekDamageGroup[]) => service.applyWeaponHits(force, runtime.instanceId, groups,
            'committed', async (command: CBTUnitCommand) => runtime.dispatch(command));
        const hits = (id: ReturnType<typeof systemDamageId>) => runtime.snapshot().damageTracks.get(id)?.hits ?? 0;
        return { runtime, location, apply, hits, ammoId };
    }

    /** A 5-ton ProtoMech without armor, a torso laser filling die faces 1-2 of torso critical weapon rolls. */
    function protoMek() {
        const laser = new WeaponEquipment({ id: 'Critical_Test_Laser', name: 'ER Small Laser', type: 'weapon',
            weapon: { damage: '5', ranges: [2, 4, 5] } });
        const entity = new TestProtoMekEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
        entity.uuid.set(UUID);
        entity.setTonnage(5);
        const laserId = componentIdForMount(addTestEquipment(entity, laser, { location: 'Torso' }));
        const runtime = createNonMekUnit(entity, { instanceId: 'critical-protomek', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
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

    /** A fighter with 20 points of nose armor (Damage Threshold 2) and SI 10. */
    function fighter() {
        const entity = new TestAeroSpaceFighterEntity();
        entity.uuid.set(UUID);
        entity.structuralIntegrity.set(10);
        entity.setArmorValue('Nose', 'front', 20);
        const runtime = createNonMekUnit(entity, { instanceId: 'critical-fighter', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const force = { getUnitSnapshot: () => ({ instanceId: runtime.instanceId, entity,
            index: runtime.getIndex(), uuid: UUID, ruleset: runtime.ruleset(), crewAssignment: runtime.getCrewAssignment(),
            editContext: { owner: runtime, state: runtime.snapshot() }, state: runtime.snapshot(), query: runtime.query(),
        }) } as unknown as CBTForce;
        const location = (code: string) => [...runtime.getIndex().locations.values()].find(row => row.code === code)!.id;
        const apply = (groups: readonly NonMekDamageGroup[]) => service.applyWeaponHits(force, runtime.instanceId, groups,
            'committed', async (command: CBTUnitCommand) => runtime.dispatch(command));
        const hits = (id: ReturnType<typeof systemDamageId>) => runtime.snapshot().damageTracks.get(id)?.hits ?? 0;
        return { entity, location, apply, hits };
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
