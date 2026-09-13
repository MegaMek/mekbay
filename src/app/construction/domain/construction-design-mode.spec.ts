// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { constructionOmniBaseSource, constructionPodField, constructionReconfigurationIssues, establishConstructionOmniBase, supportsConstructionReconfiguration } from './construction-design-mode';
import { createConstructionEntity } from './construction-factory';
import { installConstructionEquipment, moveConstructionEquipment, removeConstructionEquipment, reorderConstructionEquipment } from './construction-rules';
import { getConstructionFields } from './construction-fields';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { MiscEquipment } from '../../models/equipment.model';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { VehicleEntity } from '../../models/entity/entities/vehicle/vehicle-entity';

describe('force Omni design boundary', () => {
    const tech = { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
    const equipment = new MiscEquipment({ id: 'Omni test pod', name: 'Omni test pod', type: 'misc', tech,
        flags: ['F_MEK_EQUIPMENT', 'F_TANK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 1 } });
    const sink = new MiscEquipment({ id: 'Heat Sink', name: 'Heat Sink', type: 'misc', tech,
        flags: ['F_HEAT_SINK', 'F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 1 } });
    const double = new MiscEquipment({ id: 'ISDoubleHeatSink', name: 'Double Heat Sink', type: 'misc', tech,
        flags: ['F_DOUBLE_HEAT_SINK', 'F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 3 } });
    const jet = new MiscEquipment({ id: 'Jump Jet', name: 'Jump Jet', type: 'misc', tech,
        flags: ['F_JUMP_JET', 'F_MEK_EQUIPMENT'], stats: { tonnage: 0.5, criticalSlots: 1 } });
    const registry = createTestEquipmentRegistry(Object.fromEntries([equipment, sink, double, jet].map(item => [item.id, item])));

    it('only enables supported Omni families', () => {
        for (const kind of ['Biped', 'Quad', 'Tank', 'VTOL', 'SupportTank', 'FixedWingSupport', 'Aero'] as const) {
            const entity = createConstructionEntity(kind, registry);
            expect(supportsConstructionReconfiguration(entity)).toBeFalse();
            entity.omni.set(true);
            expect(supportsConstructionReconfiguration(entity)).withContext(kind).toBeTrue();
        }
        const armor = createConstructionEntity('BattleArmor', registry);
        armor.omni.set(true);
        expect(supportsConstructionReconfiguration(armor)).toBeFalse();
    });

    it('ignores pod installations, removals and movements while preserving chassis changes', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.omni.set(true);
        const baseline = constructionOmniBaseSource(entity);
        const pod = installConstructionEquipment(entity, equipment, 'RT');
        expect(constructionOmniBaseSource(entity)).toBe(baseline);
        const moved = moveConstructionEquipment(entity, pod, 'LT');
        expect(constructionOmniBaseSource(entity)).toBe(baseline);
        removeConstructionEquipment(entity, moved);
        expect(constructionOmniBaseSource(entity)).toBe(baseline);
        entity.chassis.set('Changed core');
        expect(constructionOmniBaseSource(entity)).not.toBe(baseline);
    });

    it('allows fixed slots to shift within their body location but detects removal and relocation', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.omni.set(true);
        const pod = installConstructionEquipment(entity, equipment, 'RT');
        const fixed = installConstructionEquipment(entity, equipment, 'RT');
        const rear = installConstructionEquipment(entity, equipment, 'RT');
        entity.updateEquipment(mounts => mounts.map(mount => mount.mountId === fixed.mountId ? mount.clone({ omniPodMounted: false })
            : mount.mountId === rear.mountId ? mount.clone({ omniPodMounted: false, rearMounted: true }) : mount));
        const baseline = constructionOmniBaseSource(entity);
        reorderConstructionEquipment(entity, 'RT', fixed.mountId, pod.mountId);
        expect(constructionOmniBaseSource(entity)).toBe(baseline);
        reorderConstructionEquipment(entity, 'RT', rear.mountId, fixed.mountId);
        expect(constructionOmniBaseSource(entity)).toBe(baseline);
        const current = entity.equipment().find(mount => mount.mountId === fixed.mountId)!;
        const moved = moveConstructionEquipment(entity, current, 'LT');
        expect(constructionOmniBaseSource(entity)).not.toBe(baseline);
        removeConstructionEquipment(entity, moved);
        expect(constructionOmniBaseSource(entity)).not.toBe(baseline);
    });

    it('permits biped arm-actuator reconfiguration, not chassis or quad-leg systems', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.omni.set(true);
        const baseline = constructionOmniBaseSource(entity);
        getConstructionFields(entity).find(field => field.id === 'leftHand')!.set(false);
        expect(constructionOmniBaseSource(entity)).toBe(baseline);
        expect(constructionPodField(entity, 'leftLowerArm')).toBeTrue();
        expect(constructionPodField(entity, 'engineRating')).toBeFalse();
        expect(constructionPodField(createConstructionEntity('Quad', registry), 'leftHand')).toBeFalse();
    });

    it('round-trips real pod sinks and jump jets without treating derived counts as base edits', () => {
        const entity = createConstructionEntity('Biped', registry) as MekEntity;
        entity.configureHeatSinks(sink, 10);
        entity.omni.set(true);
        const baseline = constructionOmniBaseSource(entity);
        for (const item of [sink, jet]) {
            const pod = installConstructionEquipment(entity, item, 'RT');
            expect(constructionOmniBaseSource(entity)).withContext(item.name).toBe(baseline);
            expect(constructionReconfigurationIssues(entity)).toEqual([]);
            const moved = moveConstructionEquipment(entity, pod, 'LT');
            expect(constructionOmniBaseSource(entity)).toBe(baseline);
            removeConstructionEquipment(entity, moved);
            expect(constructionOmniBaseSource(entity)).toBe(baseline);
        }
        installConstructionEquipment(entity, double, 'RT');
        expect(constructionReconfigurationIssues(entity)).toContain('Pod heat sinks must use the fixed chassis heat-sink type.');
    });

    it('keeps the base engine jump limit when installing additional pod jets', () => {
        const entity = createConstructionEntity('Biped', registry) as MekEntity;
        entity.omni.set(true);
        for (let count = 0; count < entity.originalWalkMP() + 1; count++) installConstructionEquipment(entity, jet, 'RT');
        expect(constructionReconfigurationIssues(entity)).toContain('Standard jump jets cannot exceed walk MP.');
    });

    it('inherits a vehicle turret capacity even when its original file used automatic turret mass', () => {
        const entity = createConstructionEntity('Tank', registry) as VehicleEntity;
        entity.omni.set(true);
        entity.hasTurret.set(true);
        const pod = installConstructionEquipment(entity, equipment, 'Turret');
        establishConstructionOmniBase(entity);
        expect(entity.baseChassisTurretWeight()).toBe(0.5);
        removeConstructionEquipment(entity, pod);
        expect(entity.baseChassisTurretWeight()).toBe(0.5);
        for (let count = 0; count < 6; count++) installConstructionEquipment(entity, equipment, 'Turret');
        expect(constructionReconfigurationIssues(entity)).toContain('Turret equipment requires 1 t of turret structure; the base chassis provides 0.5 t.');
    });
});
