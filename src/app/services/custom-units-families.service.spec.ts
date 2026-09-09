// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity } from '../construction/domain/construction-factory';
import { getConstructionFields, type ConstructionFieldValue } from '../construction/domain/construction-fields';
import { equipmentPlacementIssues, getConstructionLocations, installConstructionEquipment, setConstructionArmor } from '../construction/domain/construction-rules';
import { BattleArmorEntity, InfantryEntity, VehicleEntity } from '../models/entity/entities';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import { AmmoEquipment, WeaponEquipment, type Equipment } from '../models/equipment.model';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { MekEntity } from '../models/entity/entities';
import { buildEquipmentRegistry } from './catalogs/equipment-catalog-builder';
import { CustomUnitsService } from './custom-units.service';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import type { PreparedApplicationCatalogDependencies } from './unit-catalog/application-catalog-bundle-coordinator.service';
import { EntityUnitSummaryProjector } from './unit-catalog/entity-summary-projector';

describe('custom construction saves across the complete native family catalog', () => {
    let registry: EquipmentRegistry;
    let service: CustomUnitsService;
    let dependencies: PreparedApplicationCatalogDependencies;
    let rows: SavedCustomUnit[];

    beforeAll(async () => {
        const response = await fetch('/online-assets/static/equipment.json');
        if (!response.ok) throw new Error(`Equipment fixture returned ${response.status}`);
        registry = buildEquipmentRegistry(await response.json());
        dependencies = {
            assetHashes: { equipment: 'equipment', quirks: 'quirks', sourcebooks: 'sourcebooks', sprites: 'sprites', factions: 'factions' },
            equipment: { registry }, quirks: { quirksByKey: new Map() },
            sourcebooks: { sourcebooksByAbbrev: new Map() },
            sprites: { assignmentContext: { assignments: undefined } },
            getProjector: async () => new EntityUnitSummaryProjector(registry),
        } as unknown as PreparedApplicationCatalogDependencies;
    });

    beforeEach(() => {
        rows = [];
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(), CustomUnitsService,
            { provide: DbService, useValue: {
                unitArtworkChanges: new Subject(), listUnitArtwork: async () => new Map(),
                listCustomUnits: async () => structuredClone(rows),
                listCustomUnitSummaries: async () => [],
                saveCustomUnitSummaries: async () => undefined,
                updateCustomUnits: async (changes: Parameters<DbService['updateCustomUnits']>[0]) => changes.map(change => {
                    const current = rows.find(row => row.uuid === change.uuid && (row.accountUuid ?? '') === change.accountUuid);
                    const next = change.update(current);
                    rows = rows.filter(row => row !== current);
                    if (next) rows.push(structuredClone(next));
                    return next;
                }),
            } },
            { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
        ] });
        service = TestBed.inject(CustomUnitsService);
        service.commitSummaries(dependencies, []);
    });

    it('retains conditional Omni turret weights and infantry secondary weapon counts', () => {
        const tank = createConstructionEntity('Tank', registry) as VehicleEntity;
        tank.hasTurret.set(true);
        expect(getConstructionFields(tank).some(field => field.id === 'baseTurretMass')).toBeFalse();
        tank.omni.set(true);
        getConstructionFields(tank).find(field => field.id === 'dualTurret')!.set(true);
        getConstructionFields(tank).find(field => field.id === 'baseTurretMass')!.set(2.5);
        getConstructionFields(tank).find(field => field.id === 'baseTurret2Mass')!.set(1.5);
        const restoredTank = service.parseDraft(encodeNativeEntity(tank), 'blk') as VehicleEntity;
        expect(restoredTank.hasDualTurret()).toBeTrue();
        expect(restoredTank.baseChassisTurretWeight()).toBe(2.5);
        expect(restoredTank.baseChassisTurret2Weight()).toBe(1.5);

        const infantry = createConstructionEntity('Infantry', registry) as InfantryEntity;
        getConstructionFields(infantry).find(field => field.id === 'secondaryWeapon')!.set('InfantryAssaultRifle');
        getConstructionFields(infantry).find(field => field.id === 'secondaryCount')!.set(2);
        const restoredInfantry = service.parseDraft(encodeNativeEntity(infantry), 'blk') as InfantryEntity;
        expect(restoredInfantry.secondaryWeapon()?.id).toBe('InfantryAssaultRifle');
        expect(restoredInfantry.secondaryCount()).toBe(2);
    });

    for (const kind of CONSTRUCTION_UNIT_TYPES) {
        if (kind.id !== 'Infantry') it(`persists a native ammunition bin for ${kind.label}`, async () => {
            const entity = createConstructionEntity(kind.id, registry);
            const locations = getConstructionLocations(entity);
            const weapon = Object.values(registry.equipment).find((equipment): equipment is WeaponEquipment =>
                equipment instanceof WeaponEquipment && !equipment.oneShotCount && !equipment.isInfantryWeapon()
                && registry.getAmmoForWeapon(equipment).some(ammo => ammo.shots > 0)
                && locations.some(location => equipmentPlacementIssues(entity, equipment, location.id).length === 0));
            expect(weapon).withContext(`${kind.id} ammunition-using weapon`).toBeDefined();
            if (!weapon) return;
            installConstructionEquipment(entity, weapon,
                locations.find(location => equipmentPlacementIssues(entity, weapon, location.id).length === 0)!.id);
            const ammunition = registry.getAmmoForWeapon(weapon).find((equipment): equipment is AmmoEquipment =>
                equipment instanceof AmmoEquipment && equipment.shots > 0
                && locations.some(location => equipmentPlacementIssues(entity, equipment, location.id).length === 0));
            expect(ammunition).withContext(`${kind.id} compatible ammunition`).toBeDefined();
            if (!ammunition) return;
            const location = locations.find(location => equipmentPlacementIssues(entity, ammunition, location.id).length === 0)!;
            const mount = installConstructionEquipment(entity, ammunition, location.id);
            const variableShots = ['BattleArmor', 'ProtoMek', 'HandheldWeapon', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation']
                .includes(entity.entityType);
            const shots = variableShots ? Math.max(1, ammunition.shots - 1) : ammunition.shots;
            if (variableShots) entity.updateEquipment(mounts => mounts.map(item => item.mountId === mount.mountId
                ? item.clone({ shotsCount: shots }) : item));
            const record = await service.save(entity);
            const loaded = await service.load(record.uuid);
            const restored = loaded.equipment().find(item => item.equipmentId === ammunition.id);
            expect(restored).withContext(ammunition.id).toBeDefined();
            expect(restored?.getAmmoShots()).withContext(`${kind.id} ${ammunition.id}`).toBe(shots);
        });

        it(`retains every exposed construction field in native snapshots for ${kind.label}`, () => {
            const fields = getConstructionFields(createConstructionEntity(kind.id, registry));
            for (const descriptor of fields) {
                const entity = createConstructionEntity(kind.id, registry);
                const field = getConstructionFields(entity).find(value => value.id === descriptor.id)!;
                const previous = field.get();
                const value: ConstructionFieldValue | undefined = field.kind === 'boolean' ? !previous
                    : field.kind === 'number' ? Math.max(field.min ?? -Infinity,
                        Math.min(field.max ?? Infinity, Math.max(Number(previous) + (field.step ?? 1), 0.01)))
                    : field.kind === 'select' ? field.options?.find(option => String(option.value) !== String(previous))?.value
                    : field.id === 'gravDecks' ? '50, 75' : field.id === 'turretConfig' ? 'Modular:1'
                    : `${previous} edited`.trim();
                if (value === undefined) continue;
                field.set(value);
                const expected = field.get();
                const loaded = service.parseDraft(encodeNativeEntity(entity), entity instanceof MekEntity ? 'mtf' : 'blk');
                const actual = getConstructionFields(loaded).find(item => item.id === field.id)?.get();
                expect(actual).withContext(`${kind.id}.${field.id}`).toEqual(expected);
                if (field.id === 'engineType') for (const choice of field.options ?? []) {
                    const engineDesign = createConstructionEntity(kind.id, registry);
                    getConstructionFields(engineDesign).find(item => item.id === 'engineType')!.set(choice.value);
                    expect(() => service.parseDraft(encodeNativeEntity(engineDesign), engineDesign instanceof MekEntity ? 'mtf' : 'blk'))
                        .withContext(`${kind.id} engine ${choice.value}`).not.toThrow();
                }
            }
        });

        it(`persists equipment, protection and identity edits for ${kind.label}`, async () => {
            const entity = createConstructionEntity(kind.id, registry);
            const originalUuid = entity.uuid();
            entity.chassis.set(`Workshop ${kind.id}`);
            entity.model.set('Saved variant');
            entity.year.set(3150);

            // Standard native weapons exercise real registry definitions and aliases.
            const equipmentId = entity instanceof InfantryEntity ? 'InfantryAssaultRifle'
                : entity instanceof BattleArmorEntity ? 'ISBASmallLaser'
                : kind.id === 'ProtoMek' ? 'CLERSmallLaser' : 'Medium Laser';
            const equipment = registry.findEquipment(equipmentId) as Equipment;
            expect(equipment).withContext(equipmentId).toBeTruthy();
            const location = getConstructionLocations(entity).find(loc =>
                equipmentPlacementIssues(entity, equipment, loc.id).length === 0);
            expect(location).withContext(`${kind.id} ${equipmentId} placement`).toBeDefined();
            if (!location) return;
            installConstructionEquipment(entity, equipment, location.id);

            // BA suit armor is a shared native construction value; infantry
            // uses its family-specific protection input.
            const armorLocation = entity instanceof BattleArmorEntity ? 'Squad'
                : entity instanceof InfantryEntity
                    ? undefined : entity.armorLocations.find(loc => (entity.maxArmorValues().get(loc) ?? 0) > 0);
            if (armorLocation) setConstructionArmor(entity, armorLocation, 2, entity.hasRearArmor(armorLocation) ? 1 : 0);
            if (entity instanceof InfantryEntity) entity.armorDivisor.set(2);

            const saved = await service.save(entity, { originalUnitUuid: originalUuid });
            const loaded = await service.load(saved.uuid);
            expect(saved.uuid).not.toBe(originalUuid);
            expect(saved.originalUnitUuid).toBe(originalUuid);
            expect(entity.uuid()).toBe(originalUuid);
            expect(loaded.entityType).toBe(entity.entityType);
            expect(loaded.chassis()).toBe(entity.chassis());
            expect(loaded.model()).toBe(entity.model());
            expect(loaded.year()).toBe(3150);
            expect(loaded.equipment().some(mount => mount.equipmentId === equipment.id)).withContext(equipment.id).toBeTrue();
            if (armorLocation) {
                expect(loaded.getArmorValue(armorLocation)).withContext(armorLocation).toBe(2);
                expect(loaded.getArmorValue(armorLocation, 'rear')).withContext(armorLocation).toBe(entity.hasRearArmor(armorLocation) ? 1 : 0);
            }
            if (loaded instanceof InfantryEntity) expect(loaded.armorDivisor()).toBe(2);
            const summary = (await service.prepareSummaries(dependencies))[0];
            expect(summary).toBeDefined();
            expect(summary.uuid).toBe(saved.uuid);
            expect(summary.isCustom).toBeTrue();
            expect(summary.originalUnitUuid).toBe(originalUuid);
            expect(summary.origin).toBe('user');
            expect(rows.length).toBe(1);
            expect(rows[0].source).toBe(saved.source);
        });
    }
});
