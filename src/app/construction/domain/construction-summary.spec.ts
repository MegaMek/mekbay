// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { constructionSummary } from './construction-summary';
import { createConstructionEntity, getConstructionMass, getConstructionMassCapacity } from './construction-factory';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { MiscEquipment } from '../../models/equipment.model';
import { getConstructionFields } from './construction-fields';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';

describe('construction chassis summary', () => {
    const registry = createTestEquipmentRegistry();
    it('accounts for every family mass without counting equipment categories twice', () => {
        for (const kind of ['Biped', 'Tank', 'Aero', 'BattleArmor', 'ProtoMek', 'SmallCraft', 'JumpShip'] as const) {
            const entity = createConstructionEntity(kind, registry);
            const summary = constructionSummary(entity);
            expect(summary.rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)).withContext(kind).toBeCloseTo(getConstructionMass(entity)!, 6);
            expect(summary.free).toBeCloseTo(getConstructionMassCapacity(entity) - summary.total, 6);
        }
    });
    it('separates jump equipment and reports its technology while retaining the same total mass', () => {
        const entity = createConstructionEntity('Biped', registry);
        const jet = new MiscEquipment({ id: 'Summary jump jet', name: 'Summary jump jet', type: 'misc',
            flags: ['F_JUMP_JET'], stats: { tonnage: 0.5, criticalSlots: 1 },
            tech: { base: 'IS', rating: 'E', level: 'Standard', availability: { sl: 'X', sw: 'X', clan: 'D', da: 'C' },
                advancement: { is: { common: '3200' } } } });
        addTestEquipment(entity, jet, { location: 'LT' });
        const summary = constructionSummary(entity);
        expect(summary.rows.find(row => row.key === 'jump')).toEqual(jasmine.objectContaining({ weight: 0.5, criticals: 1, availability: 'E/X-X-D-C' }));
        expect(summary.earliestYear).toBe(3200);
        expect(summary.rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)).toBeCloseTo(summary.total, 6);
    });
    it('uses MML cockpit, gyro and engine critical counts', () => {
        const entity = createConstructionEntity('Biped', registry) as MekEntity;
        const rows = constructionSummary(entity).rows;
        expect(rows.find(row => row.key === 'cockpit')?.criticals).toBe(1);
        expect(rows.find(row => row.key === 'gyro')?.criticals).toBe(4);
        expect(rows.find(row => row.key === 'engine')?.criticals).toBe(6);
    });
    it('exposes native design metadata through the chassis fields', () => {
        const entity = createConstructionEntity('Biped', registry);
        const fields = getConstructionFields(entity);
        fields.find(field => field.id === 'clanName')!.set('Reporting name');
        fields.find(field => field.id === 'manualBV')!.set(1234);
        fields.find(field => field.id === 'mulId')!.set(42);
        expect(entity.clanName()).toBe('Reporting name');
        expect(entity.manualBV()).toBe(1234);
        expect(entity.mulId()).toBe(42);
        expect(fields.find(field => field.id === 'faction')?.options?.length).toBeGreaterThan(1);
    });
    it('preserves the exposed metadata for MTF and every BLK writer', () => {
        for (const kind of ['Biped', 'Tank', 'Aero', 'SmallCraft', 'DropShip', 'JumpShip', 'ProtoMek', 'BattleArmor', 'Infantry', 'HandheldWeapon', 'BuildingEntity'] as const) {
            const entity = createConstructionEntity(kind, registry);
            const fields = getConstructionFields(entity);
            fields.find(field => field.id === 'manualBV')!.set(1234);
            fields.find(field => field.id === 'mulId')!.set(42);
            fields.find(field => field.id === 'faction')!.set('DC');
            const parsed = parseEntity(encodeNativeEntity(entity), kind === 'Biped' ? 'metadata.mtf' : 'metadata.blk', registry).entity;
            expect([parsed.manualBV(), parsed.mulId(), parsed.faction()]).withContext(kind).toEqual([1234, 42, 'DC']);
        }
    });
});
