// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import type { BaseEntity } from '../models/entity/base-entity';
import type { ComponentId } from '../models/entity/entity-identifiers';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { MountId } from '../models/entity/types';
import { matchNativeMounts } from '../models/entity/utils/native-mount-correspondence';
import type { EquipmentStatus } from '../models/equipment-status.model';
import type { CBTForceMember } from '../models/force-member.model';
import { hasMekRuntime, type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import type { ConstructionRuntimeChanges } from '../models/runtime/construction-runtime';
import { buildMekRuntimeIndex } from '../models/runtime/mek-runtime-index';
import { mekCriticalSlotDirectHitThreshold } from '../models/runtime/mek-critical-slot-rules';
import { mekSystemCriticalDamageThreshold } from '../models/rules/mek-system-damage-rules';
import { refitComponentIds, type ConstructionMountOrigins } from '../models/runtime/unit-construction-refit';
import { refitCriticalDamage, refitCriticalSlotTargets } from '../models/runtime/construction-refit-critical-slots';
import { nativeSourceHashCanary } from '../models/source-hash-canary';
import { CustomUnitsService } from '../services/custom-units.service';
import { asSourceHash, makeUnitFileName } from '../services/unit-catalog/unit-catalog.types';
import { sha1Base64Url } from '../utils/sha1.util';

export type { ConstructionMountOrigins } from '../models/runtime/unit-construction-refit';

/** Read-only projection of the source runtime onto the mutable construction draft. */
export interface ConstructionDamageProjection {
    /** Construction points, including half points for double-damage materials. */
    armorDamage(location: string, face?: 'front' | 'rear'): number;
    /** Construction points, including half points for Reinforced Structure. */
    internalDamage(location: string): number;
    mountStatus(mountId: string): EquipmentStatus;
    mountHits(mountId: string): number;
    mountHasCombatDamage(mountId: string): boolean;
    systemStatus(componentId: ComponentId): EquipmentStatus;
    criticalHits(location: string, slotIndex: number): number;
    criticalDestroyed(location: string, slotIndex: number): boolean;
}

@Injectable({ providedIn: 'root' })
export class ConstructionForceService {
    private readonly customUnits = inject(CustomUnitsService);

    captureOrigins(member: CBTForceMember, draft: BaseEntity): ConstructionMountOrigins {
        return matchNativeMounts(member.entity, draft);
    }

    remapOrigins(before: BaseEntity, after: BaseEntity, origins: ConstructionMountOrigins): ConstructionMountOrigins {
        return new Map([...matchNativeMounts(before, after)].flatMap(([nextId, previousId]) => {
            const origin = origins.get(previousId);
            return origin ? [[nextId, origin] as const] : [];
        }));
    }

    damage(member: CBTForceMember, draft: BaseEntity, origins: ConstructionMountOrigins, preview?: CBTUnitSnapshot): ConstructionDamageProjection {
        // Subscribe to the same witness used by existing damaged record sheets.
        member.entity instanceof MekEntity ? member.mekRecordSheetSnapshot() : member.nonMekRecordSheetSnapshot();
        const source = preview ?? member.force.getUnitSnapshot(member.id);
        const locations = new Map(source ? [...source.index.locations.values()].map(location => [location.code, location]) : []);
        const mounts = new Map(source ? [...source.index.components.values()].flatMap(component =>
            component.mount ? [[component.mount.mountId, component.id] as const] : []) : []);
        const criticals = new Map<string, number>();
        const destroyedCriticals = new Set<string>();
        const systems = new Map<ComponentId, EquipmentStatus>();
        if (source && hasMekRuntime(source) && draft instanceof MekEntity) {
            const next = buildMekRuntimeIndex(draft);
            const targets = refitCriticalSlotTargets(source.index, next, refitComponentIds(source.index, next, origins));
            const damage = refitCriticalDamage(source.index, next, source.ruleset, source.state.slots,
                source.state.pendingCombat.criticalHits, targets);
            for (const slot of next.slots.values()) {
                const location = next.locations.get(slot.locationId)!;
                const hits = damage.slots.get(slot.id)?.hits ?? 0;
                const pending = damage.pendingHits.get(slot.id) ?? 0;
                const key = `${location.code}:${slot.slotIndex}`;
                criticals.set(key, Math.max(0, hits + pending));
                if (hits + pending >= mekCriticalSlotDirectHitThreshold(slot)) destroyedCriticals.add(key);
            }
            for (const component of next.components.values()) {
                if (component.kind !== 'system') continue;
                const hits = component.placements.reduce((sum, placement) => {
                    const location = next.locations.get(placement.locationId)!;
                    if (source.index.locations.has(location.id) && source.query.locationStatus(location.id, 'preview') === 'destroyed') {
                        return sum + 1;
                    }
                    return sum + Math.max(0, (criticals.get(`${location.code}:${placement.slotIndex}`) ?? 0)
                        - (placement.armored ? 1 : 0));
                }, 0);
                systems.set(component.id, hits >= mekSystemCriticalDamageThreshold(draft, component.systemType, source.ruleset)
                    ? 'destroyed' : 'available');
            }
        }
        return {
            armorDamage: (location, face = 'front') => {
                const loc = locations.get(location);
                const armor = loc?.armorFaceIds.map(id => source!.index.armorFaces.get(id)).find(armor => armor?.face === face);
                return armor ? (armor.maximumPoints - source!.query.remainingArmor(armor.id, 'preview'))
                    / (source!.entity.armorByLocation().get(location)?.damagePerPoint ?? 1) : 0;
            },
            internalDamage: location => {
                const loc = locations.get(location);
                return loc ? (loc.internalPoints - source!.query.remainingInternal(loc.id, 'preview'))
                    / (source!.entity.structureByLocation().get(location)?.damagePerPoint ?? 1) : 0;
            },
            mountStatus: mountId => {
                const original = origins.get(mountId as MountId);
                const component = original && mounts.get(original);
                return component ? source!.query.componentStatus(component, 'preview') : 'available';
            },
            mountHits: mountId => {
                const original = origins.get(mountId as MountId);
                const component = original && mounts.get(original);
                if (!component || !source || !hasMekRuntime(source)) return 0;
                return [...source.index.slots.values()].filter(slot => slot.componentIds.includes(component))
                    .reduce((sum, slot) => sum + Math.max(0, (source.state.slots.get(slot.id)?.hits ?? 0)
                        + (source.state.pendingCombat.criticalHits.get(slot.id) ?? 0)), 0);
            },
            mountHasCombatDamage: mountId => {
                const original = origins.get(mountId as MountId);
                const component = original && mounts.get(original);
                if (!component || !source) return false;
                const state = source.state.components.get(component);
                if (state?.jammed || state?.escalatingFailure?.active) return true;
                if (!hasMekRuntime(source)) return false;
                const pending = source.state.pendingCombat.shieldDamage.get(component);
                return (state?.shieldDamage?.absorptionDamage ?? 0) + (pending?.absorptionDamage ?? 0) > 0
                    || (state?.shieldDamage?.capacityDamage ?? 0) + (pending?.capacityDamage ?? 0) > 0;
            },
            criticalHits: (location, slotIndex) => criticals.get(`${location}:${slotIndex}`) ?? 0,
            criticalDestroyed: (location, slotIndex) => destroyedCriticals.has(`${location}:${slotIndex}`),
            systemStatus: componentId => systems.get(componentId) ?? 'available',
        };
    }

    async applySavedConstruction(
        member: CBTForceMember, saved: SavedCustomUnit, draft: BaseEntity, origins: ConstructionMountOrigins,
        runtime?: ConstructionRuntimeChanges,
        requireRepaired = false,
    ): Promise<CBTForceMember> {
        if (member.force.readOnly()) throw new Error('This force is read-only');
        // Parse the captured save, never a later edit or another tab's newer custom revision.
        const entity = this.customUnits.parseDraft(saved.source, saved.format);
        entity.uuid.set(saved.uuid);
        const savedOrigins = this.remapOrigins(draft, entity, origins);
        const bytes = new TextEncoder().encode(saved.source).buffer as ArrayBuffer;
        const hash = await sha1Base64Url(bytes);
        return member.force.applyConstruction(member, { entity, source: {
            file: makeUnitFileName(saved.uuid, saved.format), format: saved.format,
            isCustom: true,
            sourceHash: asSourceHash(hash),
            sourceHashCanary: await nativeSourceHashCanary(saved.source, saved.format), bytes,
        }, origins: savedOrigins }, runtime, requireRepaired);
    }
}
