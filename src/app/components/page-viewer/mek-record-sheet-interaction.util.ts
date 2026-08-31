// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../picker/picker.interface';
import type { CBTUnitCommand, MekUnitQueryPort } from '../../models/runtime/unit-instance';
import { createCommandId } from '../../models/runtime/runtime-state';
import type { MekHeatAutomationPolicyV2 } from '../../models/runtime/mek-heat-state-v2';
import type { MekRecordSheetSnapshot } from '../../models/runtime/mek-record-sheet';
import type { MekRecordSheetInteraction } from './mek-record-sheet-binder';

export interface RecordSheetDamagePickerRange {
    readonly min: number;
    readonly max: number;
    readonly threshold?: number;
    readonly title: string;
}

/** Minimal live runtime facts needed to turn one displayed interaction into a command. */
export interface MekRecordSheetCommandSource {
    readonly query: Pick<MekUnitQueryPort, 'crewState' | 'hasCondition'>;
    readonly heatSinkCount: number;
    readonly heatPolicy: MekHeatAutomationPolicyV2;
}

export function recordSheetDamagePickerRange(
    interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' | 'critical' | 'shield' }>,
    snapshot: MekRecordSheetSnapshot,
    pending: boolean,
): RecordSheetDamagePickerRange {
    if (interaction.kind === 'armor') {
        const face = snapshot.locations.flatMap(location => location.armor)
            .find(candidate => candidate.faceId === interaction.faceId);
        if (!face) throw new Error(`Unknown armor face ${interaction.faceId}`);
        const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
        const faceRemaining = pending ? face.previewRemaining : face.committedRemaining;
        const modularRemaining = location?.modularArmor
            ? pending ? location.modularArmor.previewRemaining : location.modularArmor.committedRemaining
            : 0;
        const modularDamage = location?.modularArmor
            ? pending ? location.modularArmor.previewDamage : location.modularArmor.committedDamage
            : 0;
        const remaining = faceRemaining + modularRemaining;
        const internalRemaining = location
            ? pending ? location.previewRemainingInternal : location.committedRemainingInternal
            : 0;
        return {
            min: -((face.maximum - faceRemaining) + modularDamage),
            max: remaining + internalRemaining,
            threshold: remaining,
            title: `${face.locationCode}${face.face === 'rear' ? ' (Rear)' : ''} Armor`,
        };
    }
    if (interaction.kind === 'internal') {
        const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
        if (!location) throw new Error(`Unknown location ${interaction.locationId}`);
        const remaining = pending ? location.previewRemainingInternal : location.committedRemainingInternal;
        return { min: -(location.maximumInternal - remaining), max: remaining, title: `${location.code} Internal` };
    }
    if (interaction.kind === 'shield') {
        const shield = snapshot.shields.find(candidate =>
            candidate.componentId === interaction.componentId
            && candidate.track === interaction.track);
        if (!shield) throw new Error(`Unknown shield track ${interaction.componentId}:${interaction.track}`);
        const remaining = pending ? shield.previewRemaining : shield.committedRemaining;
        const damage = pending ? shield.previewDamage : shield.committedDamage;
        const label = interaction.track === 'absorption' ? 'DA' : 'DC';
        return {
            min: damage === 0 ? 0 : -damage,
            max: remaining,
            title: `${shield.locationCode} Shield ${label}`,
        };
    }
    const slot = snapshot.criticalSlots.find(candidate => candidate.slotId === interaction.slotId);
    if (!slot) throw new Error(`Unknown critical slot ${interaction.slotId}`);
    const hits = pending ? slot.previewHits : slot.committedHits;
    const capacity = slot.hitCapacity;
    return { min: -hits, max: Math.max(0, capacity - hits), title: `${slot.locationCode} Critical ${slot.slotIndex + 1}` };
}

export function recordSheetDamageChoices(min: number, max: number): PickerChoice[] {
    const preferred = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 50, 100, 200, 350, 500,
        -1, -2, -3, -4, -5, -10, -15, -20, -50, -100, -200, -350, -500];
    return [...new Set([...preferred.filter(value => value >= min && value <= max), min, max])]
        .sort((left, right) => left - right)
        .map(value => ({ label: String(value), value }));
}

export function recordSheetCommand(
    interaction: MekRecordSheetInteraction,
    source: MekRecordSheetCommandSource,
    trackPhaseAndTurn: boolean,
    delta?: number,
): CBTUnitCommand {
    const common = { commandId: createCommandId(), expectedRevision: interaction.expectedRevision };
    const target = trackPhaseAndTurn ? 'pending' as const : 'committed' as const;
    switch (interaction.kind) {
        case 'armor':
            return (delta ?? (interaction.button === 'primary' ? 1 : -1)) > 0
                ? { ...common, type: 'damage-armor', faceId: interaction.faceId, amount: Math.abs(delta ?? 1), target }
                : { ...common, type: 'repair-armor', faceId: interaction.faceId, amount: Math.abs(delta ?? -1), target };
        case 'internal':
            return (delta ?? (interaction.button === 'primary' ? 1 : -1)) > 0
                ? { ...common, type: 'damage-internal', locationId: interaction.locationId, amount: Math.abs(delta ?? 1), target }
                : { ...common, type: 'repair-internal', locationId: interaction.locationId, amount: Math.abs(delta ?? -1), target };
        case 'critical':
            return (delta ?? (interaction.button === 'primary' ? 1 : -1)) > 0
                ? { ...common, type: 'hit-critical', slotId: interaction.slotId, hits: Math.abs(delta ?? 1), target }
                : { ...common, type: 'repair-critical', slotId: interaction.slotId, hits: Math.abs(delta ?? -1), target };
        case 'shield':
            return (delta ?? (interaction.button === 'primary' ? 1 : -1)) > 0
                ? {
                    ...common,
                    type: 'damage-shield',
                    componentId: interaction.componentId,
                    track: interaction.track,
                    amount: Math.abs(delta ?? 1),
                    target,
                }
                : {
                    ...common,
                    type: 'repair-shield',
                    componentId: interaction.componentId,
                    track: interaction.track,
                    amount: Math.abs(delta ?? -1),
                    target,
                };
        case 'system-critical': {
            const change = delta ?? 1;
            return change > 0
                ? { ...common, type: 'hit-critical', slotId: interaction.slotId, hits: Math.abs(change), target }
                : { ...common, type: 'repair-critical', slotId: interaction.slotId, hits: Math.abs(change), target };
        }
        case 'crew-wounds': {
            const state = source.query.crewState(interaction.positionId);
            return {
                ...common,
                type: 'set-crew-state',
                positionId: interaction.positionId,
                wounds: interaction.wounds,
                unconscious: state.unconscious,
                ejected: state.ejected,
            };
        }
        case 'heat':
            return trackPhaseAndTurn
                ? { ...common, type: 'set-pending-heat', heat: interaction.heat }
                : { ...common, type: 'set-heat', heat: interaction.heat };
        case 'heat-sinks-off':
            return { ...common, type: 'set-heatsinks-off', heatsinksOff: Math.max(0, Math.min(source.heatSinkCount, Math.trunc(delta ?? 0))) };
        case 'apply-heat':
            return { ...common, type: 'apply-heat', policy: source.heatPolicy };
        case 'condition':
            return { ...common, type: 'set-condition', condition: interaction.condition, active: !source.query.hasCondition(interaction.condition) };
        case 'shutdown':
            return {
                ...common,
                type: 'set-mek-shutdown-state',
                shutdown: !source.query.hasCondition('shutdown'),
            };
        case 'crew-skill':
        case 'crew-name':
        case 'crew-state-menu':
        case 'open-equipment':
        case 'heat-overflow':
        case 'heat-preview':
        case 'heat-preview-end':
        case 'condition-menu':
        case 'location-condition-menu':
        case 'inventory-selection':
        case 'action-selection':
        case 'reference-table':
            throw new Error(`${interaction.kind} is not a direct unit command`);
    }
}

export function recordSheetEventPosition(event: Event): { readonly x: number; readonly y: number } {
    if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
    if (!(event.currentTarget instanceof Element)) return { x: 0, y: 0 };
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
