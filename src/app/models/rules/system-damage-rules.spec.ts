// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { drawCompactVehicleCriticalPanel } from '../../utils/sheets/layouts/vehicle-record-sheet-components';
import {
TestAeroSpaceFighterEntity,TestBattleArmorEntity,TestBipedMekEntity,TestDropShipEntity,
TestInfantryEntity,
TestLargeSupportTankEntity,
TestProtoMekEntity,TestTankEntity
} from '../entity/testing/test-entities';
import { buildNonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import { systemDamageControls } from '../runtime/system-damage-presentation';
import { mekGyroDestructionHits,mekSystemDamageDisplayCapacities } from './mek-system-damage-rules';
import { protoMekCriticalReferences } from './protomek-critical-rules';
import { systemDamageDefinitions,systemDamageId } from './system-damage-rules';

describe('semantic system damage targets', () => {
    it('generates accessible controls for every actual split facing and both turrets', () => {
        const entity = new TestLargeSupportTankEntity();
        entity.hasDualTurret.set(true);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        drawCompactVehicleCriticalPanel(svg, entity, { x: 0, y: 0, width: 160, height: 100 }, false);
        for (const id of ['stabilizer_hit_front_left', 'stabilizer_hit_front_right', 'stabilizer_hit_rear_left',
            'stabilizer_hit_rear_right', 'turret_locked_f', 'turret_locked_r']) {
            const control = svg.querySelector(`#${id}`);
            expect(control).withContext(id).not.toBeNull();
            expect(control?.closest('[display="none"]')).withContext(id).toBeNull();
        }
        expect(svg.querySelector('#stabilizer_hit_left')).toBeNull();
    });

    it('derives scoped turret targets from construction independently of printed location names', () => {
        const entity = new TestTankEntity();
        entity.hasDualTurret.set(true);
        spyOn(entity, 'componentLocationLabel').and.returnValue('Repeated translated caption');
        const index = buildNonMekRuntimeIndex(entity);
        expect(index.damageTracks.has(systemDamageId('turret-lock', undefined, 'Front Turret'))).toBeTrue();
        expect(index.damageTracks.has(systemDamageId('turret-lock', undefined, 'Rear Turret'))).toBeTrue();
        expect(index.damageTracks.has(systemDamageId('turret-lock', undefined, 'Turret'))).toBeFalse();
        expect([...index.damageTracks.values()].every(track => !('sheetId' in track) && !('label' in track))).toBeTrue();
    });

    it('limits fighter engines to three stages and large craft engines to six in rules and generated controls', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        const dropShip = new TestDropShipEntity();
        expect(systemDamageDefinitions(fighter).filter(track => track.system === 'engine').length).toBe(3);
        expect(systemDamageDefinitions(dropShip).filter(track => track.system === 'engine').length).toBe(6);
        expect(systemDamageControls(dropShip, 'engine')).toEqual({
            ids: ['engine_hit_1', 'engine_hit_2', 'engine_hit_3', 'engine_hit_4', 'engine_hit_5', 'engine_hit_6'],
            modifiers: ['-1', '-2', '-3', '-4', '-5', 'D'],
        });
    });

    it('keeps ProtoMek system counters separate from mount slots and excludes quad arms and absent main guns', () => {
        const entity = new TestProtoMekEntity();
        const biped = systemDamageDefinitions(entity);
        expect(biped.filter(track => track.system === 'left-arm').length).toBe(2);
        expect(biped.some(track => track.system === 'main-gun')).toBeFalse();
        entity.isQuad.set(true);
        entity.hasMainGun.set(true);
        const systems = systemDamageDefinitions(entity).map(track => track.system);
        expect(systems).not.toContain('left-arm');
        expect(systems).not.toContain('right-arm');
        expect(systems).toContain('main-gun');
        expect(protoMekCriticalReferences(entity).find(row => row.system === 'legs')?.rolls).toEqual([4, 5, 9, 10]);
    });

    it('does not author independent system damage for Meks, infantry, or battle armor', () => {
        for (const entity of [new TestBipedMekEntity(), new TestInfantryEntity(), new TestBattleArmorEntity()]) {
            expect(systemDamageDefinitions(entity)).withContext(entity.entityType).toEqual([]);
        }
    });

    it('keeps Mek display capacity sufficient for the configured systems without changing ruleset thresholds', () => {
        const entity = new TestBipedMekEntity();
        entity.gyroType.set('Heavy Duty');
        entity.cockpitType.set('Torso-Mounted');
        expect(mekSystemDamageDisplayCapacities(entity)).toEqual(jasmine.objectContaining({ gyro: 4, sensors: 3 }));
        expect(mekGyroDestructionHits('Heavy Duty', 'total-warfare')).toBe(3);
        expect(mekGyroDestructionHits('Heavy Duty', 'core-2026')).toBe(4);
    });
});
