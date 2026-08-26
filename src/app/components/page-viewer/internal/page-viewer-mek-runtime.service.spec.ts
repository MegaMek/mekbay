// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekRecordSheetSnapshot } from '../../../models/runtime/mek-record-sheet';
import type { MekRecordSheetInteraction } from '../mek-record-sheet-binder';
import { recordSheetCommand, recordSheetDamagePickerRange } from '../mek-record-sheet-interaction.util';
import { asComponentId } from '../../../models/entity/entity-identifiers';

describe('page-viewer published Mek runtime commands', () => {
    const revision = 9 as MekRecordSheetSnapshot['stateRevision'];
    const snapshot = {
        stateRevision: revision,
        locations: [{
            locationId: 'loc-ct', code: 'CT', maximumInternal: 7,
            committedRemainingInternal: 5, previewRemainingInternal: 3,
            armor: [{ faceId: 'face-ct', locationCode: 'CT', face: 'front', maximum: 10, committedRemaining: 8, previewRemaining: 6 }],
        }],
        criticalSlots: [{
            slotId: 'slot-ct-0', locationCode: 'CT', slotIndex: 0,
            hitCapacity: 1, committedHits: 0, previewHits: 1,
        }],
        shields: [{
            componentId: 'shield-la', locationId: 'loc-la', locationCode: 'LA',
            track: 'absorption', maximum: 5, committedDamage: 0, previewDamage: 2,
            committedRemaining: 4, previewRemaining: 2,
        }],
        crew: [{ positionId: 'crew-0', state: { wounds: 1, unconscious: true } }],
        heatSinks: { count: 10, heatsinksOff: 2 },
        conditions: ['prone'],
    } as unknown as MekRecordSheetSnapshot;

    it('maps entity-owned armor IDs to pending or committed commands without SVG data', () => {
        const interaction = {
            kind: 'armor', faceId: 'face-ct', locationId: 'loc-ct', button: 'primary', expectedRevision: revision,
        } as unknown as MekRecordSheetInteraction;
        expect(recordSheetCommand(interaction, snapshot, true)).toEqual(jasmine.objectContaining({
            type: 'damage-armor', faceId: 'face-ct', amount: 1, target: 'pending', expectedRevision: revision,
        }));
        expect(recordSheetCommand({ ...interaction, button: 'secondary' } as MekRecordSheetInteraction, snapshot, false))
            .toEqual(jasmine.objectContaining({ type: 'repair-armor', faceId: 'face-ct', amount: 1, target: 'committed' }));
        expect(recordSheetCommand(interaction, snapshot, true, 4)).toEqual(jasmine.objectContaining({ type: 'damage-armor', amount: 4 }));
        expect(recordSheetCommand(interaction, snapshot, true, -2)).toEqual(jasmine.objectContaining({ type: 'repair-armor', amount: 2 }));
    });

    it('derives picker bounds from entity maxima and runtime state', () => {
        const armor = {
            kind: 'armor', faceId: 'face-ct', locationId: 'loc-ct', button: 'primary', expectedRevision: revision,
        } as unknown as Extract<MekRecordSheetInteraction, { kind: 'armor' }>;
        expect(recordSheetDamagePickerRange(armor, snapshot, false)).toEqual({ min: -2, max: 13, threshold: 8, title: 'CT Armor' });
        expect(recordSheetDamagePickerRange(armor, snapshot, true)).toEqual({ min: -4, max: 9, threshold: 6, title: 'CT Armor' });
        expect(recordSheetDamagePickerRange({
            kind: 'critical', slotId: 'slot-ct-0', componentIds: [], button: 'primary', expectedRevision: revision,
        } as unknown as Extract<MekRecordSheetInteraction, { kind: 'critical' }>, snapshot, true))
            .toEqual({ min: -1, max: 0, title: 'CT Critical 1' });
    });

    it('maps critical, heat, and crew interactions to typed runtime commands', () => {
        expect(recordSheetCommand({
            kind: 'critical', slotId: 'slot-ct-0', componentIds: ['component-a'], button: 'primary', expectedRevision: revision,
        } as unknown as MekRecordSheetInteraction, snapshot, true)).toEqual(jasmine.objectContaining({
            type: 'hit-critical', slotId: 'slot-ct-0', hits: 1, target: 'pending',
        }));
        expect(recordSheetCommand({ kind: 'heat', heat: 12, expectedRevision: revision }, snapshot, true))
            .toEqual(jasmine.objectContaining({ type: 'set-pending-heat', heat: 12 }));
        expect(recordSheetCommand({
            kind: 'crew-wounds', positionId: 'crew-0', wounds: 2, expectedRevision: revision,
        } as unknown as MekRecordSheetInteraction, snapshot, false)).toEqual(jasmine.objectContaining({
            type: 'set-crew-state', positionId: 'crew-0', wounds: 2, unconscious: true,
        }));
        expect(recordSheetCommand({ kind: 'heat-sinks-off', expectedRevision: revision }, snapshot, false, 4))
            .toEqual(jasmine.objectContaining({ type: 'set-heatsinks-off', heatsinksOff: 4 }));
        expect(recordSheetCommand({ kind: 'condition', condition: 'prone', expectedRevision: revision }, snapshot, false))
            .toEqual(jasmine.objectContaining({ type: 'set-condition', condition: 'prone', active: false }));
    });

    it('maps authored shield tracks to bounded sparse runtime commands', () => {
        const interaction = {
            kind: 'shield', componentId: asComponentId('shield-la'), track: 'absorption',
            button: 'primary', expectedRevision: revision,
        } as const;
        expect(recordSheetDamagePickerRange(interaction, snapshot, false)).toEqual({
            min: 0, max: 4, title: 'LA Shield DA',
        });
        expect(recordSheetDamagePickerRange(interaction, snapshot, true)).toEqual({
            min: -2, max: 2, title: 'LA Shield DA',
        });
        expect(recordSheetCommand(interaction, snapshot, true, 2)).toEqual(jasmine.objectContaining({
            type: 'damage-shield', componentId: 'shield-la', track: 'absorption',
            amount: 2, target: 'pending',
        }));
        expect(recordSheetCommand({ ...interaction, button: 'secondary' }, snapshot, false, -1))
            .toEqual(jasmine.objectContaining({
                type: 'repair-shield', componentId: 'shield-la', track: 'absorption',
                amount: 1, target: 'committed',
            }));
    });

    it('routes the sheet shutdown control through typed shutdown and startup actions', () => {
        const interaction = { kind: 'shutdown', expectedRevision: revision } as MekRecordSheetInteraction;
        expect(recordSheetCommand(interaction, snapshot, false)).toEqual(jasmine.objectContaining({
            type: 'declare-mek-action',
            action: { schemaVersion: 1, kind: 'shutdown' },
        }));
        expect(recordSheetCommand(interaction, {
            ...snapshot,
            conditions: [...snapshot.conditions, 'shutdown'],
        } as MekRecordSheetSnapshot, false)).toEqual(jasmine.objectContaining({
            type: 'declare-mek-action',
            action: { schemaVersion: 1, kind: 'startup' },
        }));
    });
});
