// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { crewPositionCountForMekCockpit } from '../entity/components/cockpit-data';
import type { MountedArmor, MountedStructure } from '../entity/components';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type {
    EntityMountedEquipment,
    IntrinsicWeapon,
    MekLocation,
    MekSystemType,
} from '../entity/types';
import type { Equipment } from '../equipment.model';
import { ImmutableIndex } from '../entity/immutable-collections';
import {
    asArmorFaceId,
    asCrewPositionId,
    asCriticalSlotId,
    type ArmorFaceId,
    type ComponentId,
    type CrewPositionId,
    type CriticalSlotId,
    type LocationId,
} from '../entity/entity-identifiers';
import { componentIdForMount } from './non-mek-runtime-index';
import {
    mekLocationId,
    mekSystemComponentId,
} from '../entity/mek-entity-conventions';
import type {
    CBTRuntimeArmorFace,
    CBTRuntimeComponent,
    CBTRuntimeCrewPosition,
    CBTRuntimeLocation,
    CBTUnitRuntimeIndex,
} from './cbt-unit-runtime';

export interface MekIndexedLocation extends CBTRuntimeLocation {
    readonly code: MekLocation;
    readonly armor: MountedArmor;
    readonly structure: MountedStructure;
}


export interface MekIndexedEquipment extends CBTRuntimeComponent {
    readonly kind: 'equipment';
    readonly mount: EntityMountedEquipment;
}

export interface MekIndexedSystem extends CBTRuntimeComponent {
    readonly kind: 'system';
    readonly systemType: MekSystemType;
    readonly placements: readonly Readonly<{
        locationId: LocationId;
        slotIndex: number;
        armored: boolean;
    }>[];
}

export type MekIndexedComponent = MekIndexedEquipment | MekIndexedSystem;

export interface MekIndexedCriticalSlot {
    readonly id: CriticalSlotId;
    readonly locationId: LocationId;
    readonly slotIndex: number;
    readonly componentIds: readonly ComponentId[];
    readonly armored: boolean;
}


export interface MekIndexedBay {
    readonly kind: 'weapon-bay' | 'machine-gun-array';
    readonly controllerId?: ComponentId;
    readonly memberIds: readonly ComponentId[];
}

export interface MekIndexedRelationships {
    readonly linkedTargetBySource: ReadonlyMap<ComponentId, ComponentId>;
    readonly linkedSourceByTarget: ReadonlyMap<ComponentId, ComponentId>;
    readonly bays: readonly MekIndexedBay[];
}

/**
 * Disposable lookup data for one Mek entity revision.
 *
 * Equipment entries point to the actual entity mounts. This index owns no
 * construction facts, equipment profiles, calculations, or runtime state.
 */
export interface MekRuntimeIndex extends CBTUnitRuntimeIndex {
    readonly locations: ReadonlyMap<LocationId, MekIndexedLocation>;
    readonly armorFaces: ReadonlyMap<ArmorFaceId, CBTRuntimeArmorFace>;
    readonly components: ReadonlyMap<ComponentId, MekIndexedComponent>;
    readonly slots: ReadonlyMap<CriticalSlotId, MekIndexedCriticalSlot>;
    readonly crewPositions: ReadonlyMap<CrewPositionId, CBTRuntimeCrewPosition>;
    readonly intrinsicActions: readonly IntrinsicWeapon[];
    readonly relationships: MekIndexedRelationships;
}

export { componentIdForMount } from './non-mek-runtime-index';

export function mountedEquipmentForComponent(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): EntityMountedEquipment | undefined {
    const component = index.components.get(componentId);
    return component?.kind === 'equipment' ? component.mount : undefined;
}

export function equipmentForComponent(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): Equipment | undefined {
    return mountedEquipmentForComponent(index, componentId)?.equipment;
}

/** Canonical entity-order locations occupied by one indexed component. */
export function componentLocationIds(
    index: MekRuntimeIndex,
    componentId: ComponentId,
): readonly LocationId[] {
    const component = index.components.get(componentId);
    if (component === undefined) return Object.freeze([]);
    const occupied = component.kind === 'system'
        ? new Set(component.placements.map(placement => placement.locationId))
        : new Set([...index.locations.values()]
            .filter(location => component.mount.getOccupiedLocations().includes(location.code))
            .map(location => location.id));
    return Object.freeze([...index.locations.keys()].filter(locationId => occupied.has(locationId)));
}

export function buildMekRuntimeIndex(entity: MekEntity): MekRuntimeIndex {
    const locationIdByCode = new Map<MekLocation, LocationId>();
    const locations = new Map<LocationId, MekIndexedLocation>();
    const armorFaces = new Map<ArmorFaceId, CBTRuntimeArmorFace>();

    for (const code of entity.locationOrder) {
        const id = mekLocationId(code);
        if (id === null) throw new Error(`Unknown Mek location ${code}`);
        locationIdByCode.set(code, id);

        const values = entity.armorValues().get(code);
        const faceIds: ArmorFaceId[] = [];
        const frontId = asArmorFaceId(`armor:${id}:front`);
        faceIds.push(frontId);
        armorFaces.set(frontId, Object.freeze({
            id: frontId,
            locationId: id,
            face: 'front',
            maximumPoints: values?.front ?? 0,
        }));
        if (entity.hasRearArmor(code)) {
            const rearId = asArmorFaceId(`armor:${id}:rear`);
            faceIds.push(rearId);
            armorFaces.set(rearId, Object.freeze({
                id: rearId,
                locationId: id,
                face: 'rear',
                maximumPoints: values?.rear ?? 0,
            }));
        }
        locations.set(id, Object.freeze({
            id,
            code,
            internalPoints: entity.structureValues().get(code) ?? 0,
            armorFaceIds: Object.freeze(faceIds),
            armor: entity.armorAt(code),
            structure: entity.structureAt(code),
        }));
    }

    const components = new Map<ComponentId, MekIndexedComponent>();
    for (const mount of entity.equipment()) {
        const id = componentIdForMount(mount);
        if (components.has(id)) throw new Error(`Duplicate Mek mount ID ${mount.mountId}`);
        components.set(id, Object.freeze({ kind: 'equipment', id, mount }));
    }

    const systemPlacements = new Map<ComponentId, {
        readonly systemType: MekSystemType;
        readonly placements: Array<Readonly<{
            locationId: LocationId;
            slotIndex: number;
            armored: boolean;
        }>>;
    }>();
    const slots = new Map<CriticalSlotId, MekIndexedCriticalSlot>();
    for (const [code, grid] of entity.criticalSlotGrid()) {
        const locationId = locationIdByCode.get(code);
        if (locationId === undefined) throw new Error(`Unknown Mek critical location ${code}`);
        grid.forEach((slot, slotIndex) => {
            if (slot.type === 'empty') return;
            let componentIds: readonly ComponentId[];
            if (slot.type === 'equipment') {
                componentIds = slot.mounts.map(componentIdForMount);
            } else {
                const componentId = mekSystemComponentId(slot.systemType, locationId);
                if (!systemPlacements.has(componentId)) {
                    systemPlacements.set(componentId, {
                        systemType: slot.systemType,
                        placements: [],
                    });
                }
                systemPlacements.get(componentId)!.placements.push(Object.freeze({
                    locationId,
                    slotIndex,
                    armored: slot.armored,
                }));
                componentIds = [componentId];
            }
            const id = asCriticalSlotId(`critical:${locationId}:${slotIndex}`);
            slots.set(id, Object.freeze({
                id,
                locationId,
                slotIndex,
                componentIds: Object.freeze([...componentIds]),
                armored: slot.armored,
            }));
        });
    }
    for (const [id, system] of systemPlacements) {
        if (components.has(id)) throw new Error(`Mek system ID collides with mount ID ${id}`);
        components.set(id, Object.freeze({
            kind: 'system',
            id,
            systemType: system.systemType,
            placements: Object.freeze([...system.placements]),
        }));
    }

    const linkedTargetBySource = new Map<ComponentId, ComponentId>();
    const linkedSourceByTarget = new Map<ComponentId, ComponentId>();
    for (const source of entity.equipment()) {
        const target = entity.getLinkedMount(source);
        if (target === undefined) continue;
        const sourceId = componentIdForMount(source);
        const targetId = componentIdForMount(target);
        linkedTargetBySource.set(sourceId, targetId);
        linkedSourceByTarget.set(targetId, sourceId);
    }
    const bays = entity.equipmentBays().map(bay => Object.freeze({
        kind: bay.kind,
        ...(bay.controller === undefined
            ? {}
            : { controllerId: componentIdForMount(bay.controller) }),
        memberIds: Object.freeze(bay.mounts.map(componentIdForMount)),
    }));

    const crewPositions = new Map<CrewPositionId, CBTRuntimeCrewPosition>();
    for (let occurrence = 0; occurrence < crewPositionCountForMekCockpit(entity.cockpitType()); occurrence += 1) {
        const id = asCrewPositionId(`crew:${occurrence}`);
        crewPositions.set(id, Object.freeze({ id, occurrence }));
    }

    return Object.freeze({
        locations: new ImmutableIndex(locations),
        armorFaces: new ImmutableIndex(armorFaces),
        components: new ImmutableIndex(components),
        slots: new ImmutableIndex(slots),
        crewPositions: new ImmutableIndex(crewPositions),
        intrinsicActions: Object.freeze([...entity.intrinsicWeapons()]),
        relationships: Object.freeze({
            linkedTargetBySource: new ImmutableIndex(linkedTargetBySource),
            linkedSourceByTarget: new ImmutableIndex(linkedSourceByTarget),
            bays: Object.freeze(bays),
        }),
    });
}
