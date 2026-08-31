// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import type { CrewMemberState } from '../crew.model';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { EntityTechBase, MekLocation } from '../entity/types';
import { MiscEquipment } from '../equipment.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { UnitConditionKey } from '../unit-condition.model';
import type {
    MekHeatAutomationPolicyV2,
    MekHeatProjectionResultV2,
    MekHeatStateV2,
} from './mek-heat-state-v2';
import type {
    MekMovementPsrProjectionResultV2,
    MekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    MEK_LOCATION_CONDITION_KEYS,
    MAX_MEK_CREW_WOUNDS,
    type MekUnitRuntimeState,
    type CrewRuntimeState,
    type MekLocationConditionKey,
    type StateRevision,
} from './runtime-state';
import type { MekUnitQueryPort } from './unit-instance';
import {
    projectMekEquipmentComponents,
    type EquipmentPanelComponent,
    projectEquipmentTargets,
    type EquipmentPanelTarget,
    projectMekPhysicalAttackPresentation,
    type MekPhysicalAttackPresentation,
} from './equipment-panel';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { mekAmmoLoadouts } from './mek-ammo';
import {
    mekCriticalSlotHittable,
    mekCriticalSlotMaximumHits,
} from './mek-critical-slot-rules';
import { mekLocationParentId } from './mek-location-state-kernel';
import {
    projectMekLifeSupportPilotDamage,
    type MekLifeSupportPilotDamage,
} from './mek-life-support';
import {
    isModularArmorEquipment,
    MODULAR_ARMOR_POINTS_PER_MOUNT,
} from '../modular-armor.model';

export interface MekRecordSheetArmorFace {
    readonly faceId: ArmorFaceId;
    readonly locationId: LocationId;
    readonly locationCode: MekLocation;
    readonly face: 'front' | 'rear';
    readonly maximum: number;
    readonly committedRemaining: number;
    readonly previewRemaining: number;
}

export interface MekRecordSheetLocation {
    readonly locationId: LocationId;
    readonly code: MekLocation;
    readonly maximumInternal: number;
    readonly committedRemainingInternal: number;
    readonly previewRemainingInternal: number;
    /** Direct structural loss at this location; inherited torso loss is detachment. */
    readonly committedStructurallyDestroyed: boolean;
    readonly previewStructurallyDestroyed: boolean;
    /** Direct blow-off or physical loss inherited from this location's parent. */
    readonly committedDetached: boolean;
    readonly previewDetached: boolean;
    /** Functional parent loss, such as flooding, without physical detachment. */
    readonly committedDisabled: boolean;
    readonly previewDisabled: boolean;
    readonly conditions: readonly Readonly<{
        condition: MekLocationConditionKey;
        committed: number;
        preview: number;
    }>[];
    readonly armor: readonly MekRecordSheetArmorFace[];
    readonly modularArmor: Readonly<{
        readonly maximum: number;
        readonly committedDamage: number;
        readonly previewDamage: number;
        readonly committedRemaining: number;
        readonly previewRemaining: number;
    }>;
}

export interface MekRecordSheetSlotComponent {
    readonly componentId: ComponentId;
    readonly label: string;
    readonly system?: string;
    readonly status: EquipmentStatus;
    readonly ammo?: Readonly<{
        munitionKey: string;
        displayName: string;
        capacity: number;
        remaining: number;
    }>;
}

export interface MekRecordSheetCriticalSlot {
    readonly slotId: CriticalSlotId;
    readonly locationId: LocationId;
    readonly locationCode: MekLocation;
    readonly slotIndex: number;
    readonly armored: boolean;
    readonly hittable: boolean;
    readonly hitCapacity: number;
    readonly committedHits: number;
    readonly previewHits: number;
    readonly components: readonly MekRecordSheetSlotComponent[];
}

export interface MekRecordSheetShieldTrack {
    readonly componentId: ComponentId;
    readonly locationId: LocationId;
    readonly locationCode: 'LA' | 'RA';
    readonly track: 'absorption' | 'capacity';
    readonly maximum: number;
    /** Direct combat damage only; critical and actuator losses remain derived. */
    readonly committedDamage: number;
    /** Direct combat damage including the pending delta. */
    readonly previewDamage: number;
    readonly committedRemaining: number;
    readonly previewRemaining: number;
}

export interface MekRecordSheetCrewPosition {
    readonly positionId: CrewPositionId;
    readonly positionKey: string;
    readonly occurrence: number;
    readonly name: string;
    readonly role: string;
    readonly gunnery: number;
    readonly piloting: number;
    readonly state: CrewRuntimeState;
    /** Rule-derived display state, including lethal wounds and cockpit loss. */
    readonly effectiveState: Extract<CrewMemberState, 'healthy' | 'ejected' | 'unconscious' | 'dead'>;
}

/** Lightweight status facts for force cards and other non-sheet presentation. */
export interface MekUnitStatusSnapshot {
    readonly stateRevision: StateRevision;
    readonly conditions: readonly UnitConditionKey[];
    readonly crew: readonly Readonly<{
        readonly positionId: CrewPositionId;
        readonly effectiveState: MekRecordSheetCrewPosition['effectiveState'];
    }>[];
    readonly hasNarc: boolean;
}

/**
 * Complete record-sheet data projection. A supplied SVG is only a layout for
 * these facts; no sheet attribute or text node participates in this model.
 */
export interface MekRecordSheetSnapshot {
    readonly entityUuid: string;
    readonly ruleset: CBTRuleset;
    readonly stateRevision: StateRevision;
    readonly identity: Readonly<{
        baseChassis: string;
        model: string;
        clanName?: string;
        displayName: string;
        massTons: number;
        year: number;
        techBase: EntityTechBase;
        mixedTech?: boolean;
        form: 'biped' | 'quad' | 'tripod' | 'lam' | 'quadvee';
        engine: string;
        cockpit: string;
        gyro: string;
        myomer: string;
    }>;
    readonly construction: Readonly<{
        armor: string;
        structure: string;
    }>;
    readonly battleValue: Readonly<{
        pristine: number | null;
        current: number | null;
        adjusted: number | null;
    }>;
    readonly movement: Readonly<{
        walkMp: number;
        runMp: number;
        jumpMp: number;
        motiveType: string;
        declared: ReturnType<MekUnitQueryPort['mekMovementMode']>;
        projection: MekMovementPsrProjectionResultV2;
        psr: MekMovementPsrStateV2;
    }>;
    readonly heatSinks: Readonly<{
        count: number;
        equipmentKey?: string;
        unavailableUnits: number;
    }>;
    readonly heat: MekHeatStateV2;
    readonly heatPolicy: MekHeatAutomationPolicyV2;
    readonly heatProjection: MekHeatProjectionResultV2;
    readonly lifeSupport: MekLifeSupportPilotDamage;
    readonly destroyed: boolean;
    readonly crippled: boolean;
    readonly conditions: readonly UnitConditionKey[];
    readonly locations: readonly MekRecordSheetLocation[];
    readonly criticalSlots: readonly MekRecordSheetCriticalSlot[];
    readonly shields: readonly MekRecordSheetShieldTrack[];
    readonly equipment: readonly EquipmentPanelComponent[];
    readonly targets: readonly EquipmentPanelTarget[];
    readonly physicalAttacks: MekPhysicalAttackPresentation;
    readonly crew: readonly MekRecordSheetCrewPosition[];
}

export interface MekRecordSheetBattleValueSnapshot {
    readonly pristine: number | null;
    readonly current: number | null;
    readonly adjusted: number | null;
}

/** Projects only the runtime facts needed by compact unit-status presentation. */
export function projectMekUnitStatus(
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    query: MekUnitQueryPort,
): MekUnitStatusSnapshot {
    if (state.stateRevision !== query.stateRevision) {
        throw new Error('Unit-status state and query revisions do not match');
    }
    const destruction = query.mekDestruction();
    if (destruction.kind === 'unsupported') {
        throw new Error('Mek destruction mechanics context is unsupported');
    }
    return projectMekUnitStatusFromDestruction(entity, index, state, query, destruction);
}

export function projectMekRecordSheet(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    state: MekUnitRuntimeState,
    query: MekUnitQueryPort,
    targetRegistry: TargetRegistrySnapshot,
    suppliedBattleValue: MekRecordSheetBattleValueSnapshot | null,
    heatPolicy: MekHeatAutomationPolicyV2 = 'manual',
): MekRecordSheetSnapshot {
    if (state.stateRevision !== query.stateRevision) {
        throw new Error('Record-sheet state and query revisions do not match');
    }
    const assignment = query.crewAssignment();
    const assignedById = new Map(assignment.positions.map(position => [position.positionId, position] as const));
    const destruction = query.mekDestruction();
    if (destruction.kind === 'unsupported') {
        throw new Error('Mek destruction mechanics context is unsupported');
    }
    const unitStatus = projectMekUnitStatusFromDestruction(entity, index, state, query, destruction);

    const modularArmorByLocation = new Map<LocationId, Set<ComponentId>>();
    for (const slot of index.slots.values()) {
        for (const componentId of slot.componentIds) {
            const component = index.components.get(componentId);
            if (component?.kind !== 'equipment'
                || !isModularArmorEquipment(component.mount.equipment)
                || query.componentStatus(componentId, 'committed') !== 'available') continue;
            const components = modularArmorByLocation.get(slot.locationId) ?? new Set<ComponentId>();
            components.add(componentId);
            modularArmorByLocation.set(slot.locationId, components);
        }
    }
    const locations = [...index.locations.values()]
        .sort(compareLocation)
        .map(location => {
            const conditions = MEK_LOCATION_CONDITION_KEYS
                .map(condition => Object.freeze({
                    condition,
                    committed: query.locationCondition(location.id, condition, 'committed'),
                    preview: query.locationCondition(location.id, condition, 'preview'),
                }))
                .filter(row => row.committed > 0 || row.preview > 0);
            const armor = location.armorFaceIds.map(faceId => {
                const face = index.armorFaces.get(faceId);
                if (!face || face.locationId !== location.id) {
                    throw new Error(`Armor face ${faceId} is not owned by ${location.id}`);
                }
                return Object.freeze({
                    faceId,
                    locationId: location.id,
                    locationCode: location.code,
                    face: face.face,
                    maximum: face.maximumPoints,
                    committedRemaining: query.remainingArmor(faceId, 'committed'),
                    previewRemaining: query.remainingArmor(faceId, 'preview'),
                });
            });
            const parentId = mekLocationParentId(index, location.id);
            const committedParentStatus = parentId === null
                ? 'available'
                : query.locationStatus(parentId, 'committed');
            const previewParentStatus = parentId === null
                ? 'available'
                : query.locationStatus(parentId, 'preview');
            const committedBlownOff = query.locationCondition(location.id, 'blown-off', 'committed') > 0;
            const previewBlownOff = query.locationCondition(location.id, 'blown-off', 'preview') > 0;
            const committedFlooded = query.locationCondition(location.id, 'flooded', 'committed') > 0;
            const previewFlooded = query.locationCondition(location.id, 'flooded', 'preview') > 0;
            const committedStructurallyDestroyed = query.remainingInternal(location.id, 'committed') === 0;
            const previewStructurallyDestroyed = query.remainingInternal(location.id, 'preview') === 0;
            const modularArmorComponents = [...modularArmorByLocation.get(location.id) ?? []];
            const modularArmor = Object.freeze({
                maximum: modularArmorComponents.length * MODULAR_ARMOR_POINTS_PER_MOUNT,
                committedDamage: modularArmorComponents.reduce((sum, componentId) =>
                    sum + query.modularArmorDamage(componentId, 'committed'), 0),
                previewDamage: modularArmorComponents.reduce((sum, componentId) =>
                    sum + query.modularArmorDamage(componentId, 'preview'), 0),
                committedRemaining: modularArmorComponents.reduce((sum, componentId) =>
                    sum + query.modularArmorRemaining(componentId, 'committed'), 0),
                previewRemaining: modularArmorComponents.reduce((sum, componentId) =>
                    sum + query.modularArmorRemaining(componentId, 'preview'), 0),
            });
            return Object.freeze({
                locationId: location.id,
                code: location.code,
                maximumInternal: location.internalPoints,
                committedRemainingInternal: query.remainingInternal(location.id, 'committed'),
                previewRemainingInternal: query.remainingInternal(location.id, 'preview'),
                committedStructurallyDestroyed,
                previewStructurallyDestroyed,
                committedDetached: committedBlownOff || committedParentStatus === 'destroyed',
                previewDetached: previewBlownOff || previewParentStatus === 'destroyed',
                committedDisabled: !committedFlooded
                    && !committedStructurallyDestroyed
                    && !committedBlownOff
                    && committedParentStatus === 'disabled',
                previewDisabled: !previewFlooded
                    && !previewStructurallyDestroyed
                    && !previewBlownOff
                    && previewParentStatus === 'disabled',
                conditions: Object.freeze(conditions),
                armor: Object.freeze(armor),
                modularArmor,
            });
        });
    const criticalSlots = [...index.slots.values()]
        .sort((left, right) => compareText(left.locationId, right.locationId)
            || left.slotIndex - right.slotIndex
            || compareText(left.id, right.id))
        .map(slot => {
            const location = index.locations.get(slot.locationId);
            if (!location) throw new Error(`Slot ${slot.id} has no location`);
            const components = slot.componentIds.map(componentId => {
                const component = index.components.get(componentId);
                if (!component) throw new Error(`Slot ${slot.id} references unknown component ${componentId}`);
                const label = component.kind === 'equipment'
                    ? component.mount.displayName()
                    : component.systemType;
                const loadouts = mekAmmoLoadouts(entity, index, componentId, ruleset);
                const ammo = loadouts.length === 0
                    ? undefined
                    : (() => {
                        const loadout = query.ammoLoadout(componentId);
                        const selected = loadouts.find(candidate => candidate.munitionKey === loadout.munitionKey)
                            ?? loadouts[0]!;
                        return Object.freeze({
                            munitionKey: loadout.munitionKey,
                            displayName: selected.equipment.shortName || selected.equipment.name,
                            capacity: query.ammoCapacity(componentId),
                            remaining: query.remainingAmmo(componentId),
                        });
                    })();
                return Object.freeze({
                    componentId,
                    label,
                    ...(component.kind === 'system' ? { system: component.systemType } : {}),
                    status: query.componentStatusAtLocation(componentId, slot.locationId),
                    ...(ammo === undefined ? {} : { ammo }),
                });
            });
            return Object.freeze({
                slotId: slot.id,
                locationId: slot.locationId,
                locationCode: location.code,
                slotIndex: slot.slotIndex,
                armored: slot.armored,
                hittable: mekCriticalSlotHittable(index, slot),
                hitCapacity: mekCriticalSlotMaximumHits(index, ruleset, slot),
                committedHits: query.criticalHits(slot.id, 'committed'),
                previewHits: query.criticalHits(slot.id, 'preview'),
                components: Object.freeze(components),
            });
        });
    const committedShields = query.mekShields('committed');
    const previewShields = query.mekShields('preview');
    const previewShieldById = previewShields.kind === 'supported'
        ? new Map(previewShields.shields.map(shield => [shield.componentId, shield] as const))
        : new Map();
    const shields: MekRecordSheetShieldTrack[] = committedShields.kind === 'supported'
        ? committedShields.shields.flatMap(shield => {
            const preview = previewShieldById.get(shield.componentId);
            if (!preview) throw new Error(`Preview shield projection is missing ${shield.componentId}`);
            return [
                Object.freeze({
                    componentId: shield.componentId,
                    locationId: shield.locationId,
                    locationCode: shield.locationCode,
                    track: 'absorption' as const,
                    maximum: shield.maximumAbsorption,
                    committedDamage: query.shieldDamage(shield.componentId, 'absorption', 'committed'),
                    previewDamage: query.shieldDamage(shield.componentId, 'absorption', 'preview'),
                    committedRemaining: shield.absorption,
                    previewRemaining: preview.absorption,
                }),
                Object.freeze({
                    componentId: shield.componentId,
                    locationId: shield.locationId,
                    locationCode: shield.locationCode,
                    track: 'capacity' as const,
                    maximum: shield.maximumCapacity,
                    committedDamage: query.shieldDamage(shield.componentId, 'capacity', 'committed'),
                    previewDamage: query.shieldDamage(shield.componentId, 'capacity', 'preview'),
                    committedRemaining: shield.capacity,
                    previewRemaining: preview.capacity,
                }),
            ];
        })
        : [];
    const effectiveCrewStateById = new Map(unitStatus.crew.map(position => [
        position.positionId,
        position.effectiveState,
    ] as const));
    const crew = [...index.crewPositions.values()]
        .sort((left, right) => left.occurrence - right.occurrence
            || compareText(left.id, right.id))
        .map(position => {
            const assigned = assignedById.get(position.id);
            if (!assigned) throw new Error(`Crew assignment is missing ${position.id}`);
            const crewState = query.crewState(position.id);
            const effectiveState = effectiveCrewStateById.get(position.id);
            if (effectiveState === undefined) throw new Error(`Crew status is missing ${position.id}`);
            return Object.freeze({
                positionId: position.id,
                positionKey: position.id,
                occurrence: position.occurrence,
                name: assigned.name,
                role: assigned.role,
                gunnery: assigned.gunnery,
                piloting: assigned.piloting,
                state: Object.freeze({
                    ...crewState,
                    ejected: crewState.ejected === true,
                }),
                effectiveState,
            });
        });
    const targeting = query.attackerTargetingState();
    const targets = projectEquipmentTargets(targeting, targetRegistry);
    const equipment = projectMekEquipmentComponents(
        entity,
        index,
        ruleset,
        query,
        targeting,
        targets,
    );
    const physicalAttacks = projectMekPhysicalAttackPresentation(entity, index, ruleset, query, targeting);
    const construction = constructionLabels(index);
    const battleValue = suppliedBattleValue ?? Object.freeze({
        pristine: safePristineMekBattleValue(entity),
        current: safeCurrentMekBattleValue(query),
        adjusted: null,
    });
    const heat = query.heatState();
    const lifeSupport = projectMekLifeSupportPilotDamage(
        entity,
        index,
        ruleset,
        query,
        Math.max(0, heat.pendingOverride ?? heat.current),
    );

    return Object.freeze({
        entityUuid: entity.uuid(),
        ruleset,
        stateRevision: state.stateRevision,
        identity: Object.freeze({
            baseChassis: entity.chassis(),
            model: entity.model(),
            ...(entity.clanName().trim() ? { clanName: entity.clanName() } : {}),
            displayName: entity.displayName(),
            massTons: entity.tonnage(),
            year: entity.year(),
            techBase: entity.techBase(),
            mixedTech: entity.mixedTech(),
            form: mekForm(entity),
            engine: `${entity.mountedEngine().rating} ${entity.mountedEngine().type()}`.trim(),
            cockpit: entity.cockpitType(),
            gyro: entity.gyroType(),
            myomer: entity.myomerType(),
        }),
        construction,
        battleValue,
        movement: Object.freeze({
            walkMp: entity.walkMP(),
            runMp: entity.runMP(),
            jumpMp: entity.jumpMP(),
            motiveType: entity.motiveType(),
            declared: query.mekMovementMode(),
            projection: query.mekMovementPsr(),
            psr: query.mekMovementPsrState(),
        }),
        heatSinks: Object.freeze({
            count: entity.totalHeatSinks(),
            ...(entity.heatSinkEquipment()?.internalName === undefined
                ? {}
                : { equipmentKey: entity.heatSinkEquipment()!.internalName }),
            unavailableUnits: equipment.reduce((total, component) => {
                if (!(component.equipment instanceof MiscEquipment)
                    || !component.equipment.isHeatSink
                    || component.status === 'available') return total;
                return total + component.equipment.heatSinkUnitsPerMount;
            }, 0),
        }),
        heat,
        heatPolicy,
        heatProjection: query.heatProjection(heatPolicy),
        lifeSupport,
        destroyed: destruction.facts.committed.destroyed,
        crippled: destruction.facts.preview.crippled,
        conditions: unitStatus.conditions,
        locations: Object.freeze(locations),
        criticalSlots: Object.freeze(criticalSlots),
        shields: Object.freeze(shields),
        equipment,
        targets,
        physicalAttacks,
        crew: Object.freeze(crew),
    });
}

function projectMekUnitStatusFromDestruction(
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    query: MekUnitQueryPort,
    destruction: Extract<ReturnType<MekUnitQueryPort['mekDestruction']>, { readonly kind: 'supported' }>,
): MekUnitStatusSnapshot {
    const conditions = new Set(query.conditions());
    const crew = [...index.crewPositions.values()]
        .sort((left, right) => left.occurrence - right.occurrence
            || compareText(left.id, right.id))
        .map(position => Object.freeze({
            positionId: position.id,
            effectiveState: effectiveMekCrewState(
                entity,
                position.occurrence,
                query.crewState(position.id),
                destruction.facts.committed.mainCockpitUnavailable,
                destruction.facts.committed.commandConsoleUnavailable,
            ),
        }));
    return Object.freeze({
        stateRevision: state.stateRevision,
        conditions: Object.freeze([...conditions].sort(compareText)),
        crew: Object.freeze(crew),
        hasNarc: [...index.locations.keys()].some(locationId =>
            query.locationCondition(locationId, 'narc', 'preview') > 0),
    });
}

function effectiveMekCrewState(
    entity: MekEntity,
    occurrence: number,
    state: CrewRuntimeState,
    mainCockpitUnavailable: boolean,
    commandConsoleUnavailable: boolean,
): MekRecordSheetCrewPosition['effectiveState'] {
    if (state.wounds >= MAX_MEK_CREW_WOUNDS) return 'dead';
    const hasCommandConsole = entity.mountedCockpit().hasCommandConsoleBonus;
    const cockpitUnavailable = !hasCommandConsole
        ? mainCockpitUnavailable
        : occurrence === 0
            ? mainCockpitUnavailable
            : occurrence === 1
                ? commandConsoleUnavailable
                : false;
    if (cockpitUnavailable) return 'dead';
    if (state.ejected) return 'ejected';
    if (state.unconscious) return 'unconscious';
    return 'healthy';
}

function safeCurrentMekBattleValue(query: MekUnitQueryPort): number | null {
    try {
        const result = query.mekBattleValue();
        return result.kind === 'complete' ? result.battleValue : null;
    } catch {
        return null;
    }
}

function safePristineMekBattleValue(entity: MekEntity): number | null {
    try {
        return entity.battleValue();
    } catch {
        return null;
    }
}

function constructionLabels(index: MekRuntimeIndex): Readonly<{ armor: string; structure: string }> {
    const locations = [...index.locations.values()];
    const armor = distinctSorted(locations.map(location => location.armor.armor.name));
    const structure = distinctSorted(locations.map(location => location.structure.structure.name));
    return Object.freeze({
        armor: formatConstruction(armor),
        structure: formatConstruction(structure),
    });
}

function mekForm(entity: MekEntity): MekRecordSheetSnapshot['identity']['form'] {
    switch (entity.chassisConfig) {
        case 'Quad': return 'quad';
        case 'Tripod': return 'tripod';
        case 'LAM': return 'lam';
        case 'QuadVee': return 'quadvee';
        default: return 'biped';
    }
}

function distinctSorted(values: readonly (string | undefined)[]): readonly string[] {
    return Object.freeze([...new Set(values.filter((value): value is string => !!value?.trim()))].sort(compareText));
}

function formatConstruction(values: readonly string[]): string {
    if (values.length === 0) return '';
    return values.length === 1 ? values[0]! : `Mixed: ${values.join(', ')}`;
}

function compareLocation(
    left: { readonly code: string; readonly id: LocationId },
    right: { readonly code: string; readonly id: LocationId },
): number {
    return compareText(left.code, right.code) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
