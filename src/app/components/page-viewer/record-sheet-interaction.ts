// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ArmorFaceId,ComponentId,CrewPositionId,CriticalSlotId,LocationId,SystemDamageTrackId } from '../../models/entity/entity-identifiers';
import type { AttackerActionTarget } from '../../models/runtime/attacker-targeting-state';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import type { UnitConditionKey } from '../../models/unit-condition.model';

export type RecordSheetInteractionPayload =
    | Readonly<{
        kind: 'armor';
        faceId: ArmorFaceId;
        locationId: LocationId;
        button?: 'primary' | 'secondary';
    }>
    | Readonly<{
        kind: 'internal';
        locationId: LocationId;
        button?: 'primary' | 'secondary';
    }>
    | Readonly<{
        kind: 'critical';
        slotId: CriticalSlotId;
        componentIds: readonly ComponentId[];
        button?: 'primary' | 'secondary';
    }>
    | Readonly<{
        kind: 'shield';
        componentId: ComponentId;
        track: 'absorption' | 'capacity';
        button?: 'primary' | 'secondary';
    }>
    | Readonly<{
        kind: 'system-critical';
        slotId: CriticalSlotId;
        system: string;
        level: number;
    }>
    | Readonly<{
        kind: 'crew-wounds';
        positionId: CrewPositionId;
        wounds: number;
    }>
    | Readonly<{
        kind: 'crew-skill';
        positionId: CrewPositionId;
        skill: 'gunnery' | 'piloting';
    }>
    | Readonly<{
        kind: 'crew-name';
        positionId: CrewPositionId;
    }>
    | Readonly<{
        kind: 'crew-state-menu';
        positionId: CrewPositionId;
    }>
    | Readonly<{
        kind: 'open-equipment';
        tab: 'weapons' | 'ammo';
    }>
    | Readonly<{
        kind: 'heat';
        heat: number;
    }>
    | Readonly<{
        kind: 'heat-preview';
        heat: number;
        baselineHeat: number;
        element: SVGElement;
    }>
    | Readonly<{
        kind: 'heat-preview-end';
    }>
    | Readonly<{
        kind: 'heat-overflow';
    }>
    | Readonly<{
        kind: 'apply-heat';
    }>
    | Readonly<{
        kind: 'heat-sinks-off';
    }>
    | Readonly<{
        kind: 'condition-menu';
    }>
    | Readonly<{
        kind: 'condition';
        condition: UnitConditionKey;
    }>
    | Readonly<{
        kind: 'shutdown';
    }>
    | Readonly<{
        kind: 'location-condition-menu';
        locationId: LocationId;
    }>
    | Readonly<{
        kind: 'inventory-selection';
        componentIds: readonly ComponentId[];
        mode?: string;
        range?: 'short' | 'medium' | 'long' | 'extreme';
    }>
    | Readonly<{
        kind: 'action-selection';
        target: AttackerActionTarget;
    }>
    | Readonly<{
        kind: 'reference-table';
    }>
    | Readonly<{
        kind: 'random-hit';
        element: SVGElement;
    }>
    | Readonly<{ kind: 'infantry-strength'; locationId: LocationId; strength: number }>
    | Readonly<{ kind: 'damage-track'; damageTrackId: SystemDamageTrackId }>
    | Readonly<{ kind: 'crew-profile'; positionId: CrewPositionId }>;

/** Captured from the displayed snapshot and retained across asynchronous choices. */
export type RecordSheetInteraction = RecordSheetInteractionPayload & Readonly<{ context: UnitEditContext }>;
export type RecordSheetInteractionHandler = (interaction: RecordSheetInteraction, event: Event) => void;
export type DirectRecordSheetInteraction = Extract<RecordSheetInteraction, { readonly kind:
    'armor' | 'internal' | 'critical' | 'shield' | 'system-critical' | 'crew-wounds'
    | 'heat' | 'heat-sinks-off' | 'apply-heat' | 'condition' | 'shutdown'
}>;
