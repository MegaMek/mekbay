// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable,inject } from '@angular/core';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { merge,takeUntil } from 'rxjs';
import type { CBTUnitCommand } from '../../../models/runtime/unit-command';
import { isUnitEditContextCurrent,type UnitEditContext } from '../../../models/runtime/unit-edit-context';
import type { RecordSheetInteraction,RecordSheetInteractionHandler } from '../record-sheet-interaction';
import { recordSheetInventorySource,type RecordSheetInventorySource } from '../record-sheet-inventory';

import { CrewMember,type CrewMemberState } from '../../../models/crew-member.model';
import type { CBTForceMember } from '../../../models/force-member.model';
import { isCBTMekForceMember } from '../../../models/force-member.model';
import { rollD6 } from '../../../models/runtime/mek-automation-rules';
import type {
NonMekRecordSheetCrewPosition,
NonMekRecordSheetDamageTrack,
NonMekRecordSheetSnapshot,
} from '../../../models/runtime/non-mek-record-sheet';
import type { UnitConditionKey } from '../../../models/unit-condition.model';
import { projectNonMekMovementCapabilities } from '../../../models/runtime/non-mek-unit-instance';
import { hasNonMekRuntime } from '../../../models/cbt-unit-snapshot';
import { isCumulativeSystemDamage } from '../../../models/rules/system-damage-rules';

import {
crewStateDefinitions,
unitConditionControls,
} from '../../../models/unit-status-presentation';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { UnitNameService } from '../../../services/unit-name.service';
import { suggestedVelocityRecordValue,VELOCITY_RECORD_LABELS } from '../../../models/aerospace-velocity-record.model';
import {
recordSheetDamageChoices,
recordSheetDamageCommand,
type RecordSheetDamagePickerRange,
} from '../mek-record-sheet-interaction.util';
import {
bindNonMekRecordSheet,
type NonMekRecordSheetBinding,
} from '../non-mek-record-sheet-binder';
import { nonMekHitArcs,resolveNonMekHitLocation,type NonMekHitArc } from '../non-mek-hit-location';
import { PageViewerOverlayService } from './page-viewer-overlay.service';

interface BoundEntitySheetPage {
    readonly svg: SVGSVGElement;
    readonly binding: NonMekRecordSheetBinding;
}

interface BoundEntitySheets {
    readonly member: CBTForceMember;
    readonly pages: Map<SVGSVGElement, BoundEntitySheetPage>;
    readonly subscription: { unsubscribe(): void };
}

/** Direct non-Mek Entity + sparse-runtime binding for a supplied record sheet. */
@Injectable()
export class PageViewerNonMekRuntimeService {
    private readonly unitNames = inject(UnitNameService);
    private readonly logger = inject(LoggerService);
    private readonly overlays = inject(PageViewerOverlayService);
    private readonly options = inject(OptionsService);
    private readonly bound = new Map<string, BoundEntitySheets>();

    bind(member: CBTForceMember, svg: SVGSVGElement): boolean {
        if (isCBTMekForceMember(member)) return false;
        let current = this.bound.get(member.id);
        if (current?.member !== member) {
            this.destroyBinding(member.id);
            current = undefined;
        }
        if (current?.pages.has(svg)) return true;

        const snapshot = this.snapshot(member);
        if (!snapshot) return false;
        svg.classList.toggle('read-only', member.force.readOnly());
        const handle: RecordSheetInteractionHandler = (interaction, event) => this.handle(member, interaction, event);
        const binding = bindNonMekRecordSheet(
            svg,
            snapshot,
            member.force.readOnly() ? undefined : handle,
            handle,
            recordSheetInventorySource(member),
        );
        // Read-only viewers still own presentation controls such as page flips.
        svg.classList.add('interactive-sheet');
        if (!current) {
            current = {
                member,
                pages: new Map(),
                subscription: merge(member.force.changed, member.force.sessionChanged).subscribe(changedUnitIds => {
                    if (changedUnitIds?.includes(member.id) ?? true) this.render(member);
                }),
            };
            this.bound.set(member.id, current);
        }
        current.pages.set(svg, { svg, binding });
        this.unitNames.applyToRecordSheet(svg, member.entity);
        this.reportLayoutIssues(svg, snapshot, binding.initialIssues);
        return true;
    }

    cleanupUnused(keepUnitIds: ReadonlySet<string>): void {
        for (const unitId of [...this.bound.keys()]) {
            if (!keepUnitIds.has(unitId)) this.destroyBinding(unitId);
        }
    }

    clear(): void {
        for (const unitId of [...this.bound.keys()]) this.destroyBinding(unitId);
        this.overlays.clearSheetControls();
    }

    private snapshot(member: CBTForceMember, context?: UnitEditContext): NonMekRecordSheetSnapshot | null {
        const snapshot = member.nonMekRecordSheetSnapshot();
        return snapshot && (!context || isUnitEditContextCurrent(context, snapshot.editContext)) ? snapshot : null;
    }

    private render(member: CBTForceMember): void {
        const current = this.bound.get(member.id);
        const snapshot = this.snapshot(member);
        if (!current || current.member !== member || !snapshot) return;
        const inventory = recordSheetInventorySource(member);
        for (const page of current.pages.values()) this.renderPage(page, snapshot, inventory, member);
    }

    private renderPage(
        page: BoundEntitySheetPage,
        snapshot: NonMekRecordSheetSnapshot,
        inventory: RecordSheetInventorySource | null,
        member: CBTForceMember,
    ): void {
        const issues = page.binding.render(snapshot, inventory);
        this.unitNames.applyToRecordSheet(page.svg, member.entity);
        this.reportLayoutIssues(page.svg, snapshot, issues);
    }

    private reportLayoutIssues(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot, issues: readonly string[]): void {
        if (issues.length > 0 && svg.dataset['mekbayPartialSheet'] !== '1') {
            this.logger.warn(`Record-sheet layout omissions for ${snapshot.displayName}: ${issues.join('; ')}`);
        }
    }

    handle(member: CBTForceMember, interaction: RecordSheetInteraction, event: Event): void {
        const snapshot = this.snapshot(member);
        if (!snapshot || !isUnitEditContextCurrent(interaction.context, snapshot.editContext)) return;
        if (interaction.kind === 'reference-table') {
            this.overlays.openReferenceTable(member);
            return;
        }
        if (interaction.kind === 'movement') {
            void this.selectMovement(member, interaction, snapshot);
            return;
        }
        if (interaction.kind === 'open-equipment') {
            this.overlays.openEquipment(member.id, event, interaction.tab);
            return;
        }
        if (interaction.kind === 'random-hit') {
            this.openRandomHitPicker(member, interaction, event);
            return;
        }
        if (interaction.kind === 'heat-preview') {
            this.overlays.setHeatPreview(member.id, interaction);
            return;
        }
        if (interaction.kind === 'heat-preview-end') {
            this.overlays.clearHeatPreview(member.id);
            return;
        }
        if (interaction.kind === 'heat') {
            this.overlays.clearHeatPreview(member.id);
            void this.setHeat(member, interaction.heat, interaction.context);
            return;
        }
        if (interaction.kind === 'heat-overflow') {
            void this.promptHeat(member, snapshot);
            return;
        }
        if (interaction.kind === 'apply-heat') {
            void this.applyHeat(member, snapshot);
            return;
        }
        if (interaction.kind === 'heat-sinks-off') {
            if (!snapshot.heat.tracked) return;
            this.overlays.openActiveHeatSinksPicker(member.id, event, snapshot.heat.heatSinkCount,
                snapshot.heat.heatsinksOff, heatsinksOff => void this.overlays.dispatch(member,
                    { type: 'set-heatsinks-off', heatsinksOff }, snapshot.editContext));
            return;
        }
        if (interaction.kind === 'velocity-record') {
            this.openVelocityRecordPicker(member, interaction, snapshot, event);
            return;
        }
        if (interaction.kind === 'inventory-selection') {
            void this.overlays.selectInventory(member, interaction, event);
            return;
        }
        if (interaction.kind === 'infantry-strength') {
            void this.applyInfantryStrengthSelection(member, interaction, snapshot);
            return;
        }
        if (interaction.kind === 'damage-track') {
            void this.handleDamageTrack(member, interaction, snapshot, event);
            return;
        }
        if (interaction.kind === 'condition') {
            void this.setCondition(member, interaction.condition, !snapshot.conditions.includes(interaction.condition), interaction.context);
            return;
        }
        if (interaction.kind === 'condition-menu') {
            this.overlays.openConditionMenu(
                member,
                event,
                unitConditionControls(snapshot.conditionControlKeys).filter(control => control.placement === 'menu'),
                condition => snapshot.conditions.includes(condition),
                snapshot.editContext,
            );
            return;
        }
        if (interaction.kind === 'crew-wounds') {
            void this.setCrewWounds(member, interaction.positionId, interaction.wounds, snapshot);
            return;
        }
        if (interaction.kind === 'crew-state-menu') {
            this.openCrewStateMenu(member, interaction.positionId, snapshot, event);
            return;
        }
        if (interaction.kind === 'crew-profile') {
            this.overlays.editCrewPosition(member, interaction.positionId);
            return;
        }
        if (interaction.kind === 'crew-skill') {
            this.openCrewSkillPicker(member, interaction, snapshot, event);
            return;
        }
        if (interaction.kind === 'armor' || interaction.kind === 'internal') {
            this.openDamagePicker(member, interaction, snapshot, event);
        }
    }

    private openCrewSkillPicker(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { kind: 'crew-skill' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const position = snapshot.crew.find(row => row.positionId === interaction.positionId);
        if (!position || position.effectiveState === 'vacant') return;
        const gunnery = interaction.skill === 'gunnery' || interaction.skill === 'aeroGunnery';
        const field = member.entity.unitType() === 'Aero'
            ? (gunnery ? 'aeroGunnery' : 'aeroPiloting')
            : (gunnery ? 'gunnery' : 'piloting');
        this.overlays.openCrewSkillPicker(member, event, interaction.positionId, field, interaction.context);
    }

    private async selectMovement(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { kind: 'movement' }>,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const selected = snapshot.movementSelection.selectedMode === interaction.mode;
        const option = snapshot.movementSelection.options.find(option => option.mode === interaction.mode);
        if (!selected && !option?.legal) return;
        const unit = member.force.getUnitSnapshot(member.id);
        if (!unit || !hasNonMekRuntime(unit)) return;
        const capabilities = projectNonMekMovementCapabilities(unit.entity, unit.index, unit.state,
            unit.ruleset, unit.crewAssignment);
        await this.overlays.dispatch(member, {
            type: 'set-movement',
            movement: selected ? null : {
                mode: interaction.mode, distance: option!.minimumMp,
                boosterComponentIds: interaction.mode === 'run' ? capabilities.boosterComponentIds : [],
            },
        }, interaction.context);
    }

    private openRandomHitPicker(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'random-hit' }>,
        event: Event,
    ): void {
        this.overlays.openRandomHitPicker(member.id, interaction.element, event, nonMekHitArcs(member.entity), arc => {
            const snapshot = this.snapshot(member, interaction.context);
            const hit = snapshot && resolveNonMekHitLocation(member.entity, snapshot, arc as NonMekHitArc,
                rollD6() + rollD6(), () => rollD6());
            return hit ? { ...hit, rear: false, throughArmorCritical: false } : null;
        });
    }

    private async setHeat(member: CBTForceMember, heat: number, context: UnitEditContext): Promise<void> {
        if (!this.snapshot(member, context)?.heat.tracked) return;
        await this.overlays.dispatch(member, {
            type: this.options.options().trackPhaseAndTurn ? 'set-pending-heat' : 'set-heat',
            heat: Math.max(0, Math.trunc(heat)),
        }, context);
    }

    private async applyHeat(member: CBTForceMember, snapshot: NonMekRecordSheetSnapshot): Promise<void> {
        if (!snapshot.heat.tracked || snapshot.heat.pending === null) return;
        await this.overlays.dispatch(member, { type: 'apply-heat', policy: snapshot.heatPolicy }, snapshot.editContext);
    }

    private async promptHeat(member: CBTForceMember, snapshot: NonMekRecordSheetSnapshot): Promise<void> {
        const heat = await this.overlays.promptHeat(snapshot.heat.pending ?? snapshot.heat.current);
        if (heat !== null) await this.setHeat(member, heat, snapshot.editContext);
    }

    /** Sets one velocity record cell, starting from the latest value in its row; a secondary click clears it. */
    private openVelocityRecordPicker(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'velocity-record' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const { turn, field } = interaction;
        const write = (value: number | null): void => {
            if (this.snapshot(member, interaction.context)) {
                void this.overlays.dispatch(member, { type: 'set-velocity-record', turn, field, value }, interaction.context);
            }
        };
        if (event.type === 'contextmenu') {
            this.overlays.closePicker();
            write(null);
            return;
        }
        const selected = suggestedVelocityRecordValue(snapshot.velocityRecord, turn, field);
        // Thrust is bounded by the unit's maximum thrust and altitude by the low-altitude map; velocity has headroom.
        const limit = field === 'thrust' ? member.entity.runMP() : field === 'altitude' ? 10 : 30;
        this.overlays.openNumberPicker(member.id, event, {
            min: 0,
            max: Math.max(limit, selected),
            selected,
            title: `Turn ${turn} ${VELOCITY_RECORD_LABELS[field]}`,
        }, write);
    }

    private async setCondition(member: CBTForceMember, condition: UnitConditionKey, active: boolean, context: UnitEditContext): Promise<void> {
        if (this.snapshot(member, context)) await this.overlays.dispatch(member, { type: 'set-condition', condition, active }, context);
    }

    private async setCrewWounds(
        member: CBTForceMember,
        positionId: NonMekRecordSheetSnapshot['crew'][number]['positionId'],
        wounds: number,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const position = snapshot?.crew.find(row => row.positionId === positionId);
        if (!snapshot || !position) return;
        await this.overlays.dispatch(member, {
            type: 'set-crew-state',
            positionId,
            wounds,
            unconscious: position.state.unconscious,
            ejected: position.state.ejected,
        }, snapshot.editContext);
    }

    private openCrewStateMenu(
        member: CBTForceMember,
        positionId: NonMekRecordSheetSnapshot['crew'][number]['positionId'],
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const position = snapshot.crew.find(row => row.positionId === positionId);
        const anchor = event.currentTarget;
        if (!position || !(anchor instanceof Element)) return;
        const controls = crewStateDefinitions(snapshot.crewStateControlKeys);
        if (controls.length === 0) return;
        const { componentRef, closed } = this.overlays.openStateMenu(member.id, 'crew-state', anchor, event);
        componentRef.setInput('choices', controls.map(control => ({
            key: control.key,
            label: control.label,
            color: control.color,
            active: CrewMember.from(position.state).hasState(control.key),
        })));
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(selected => {
            const command = nonMekCrewStateCommand(position, snapshot.crewStateControlKeys, selected);
            if (command) void this.overlays.dispatch(member, command, snapshot.editContext);
            this.overlays.closeMenu('crew-state');
        });
    }

    private async handleDamageTrack(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'damage-track' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): Promise<void> {
        const track = snapshot.damageTracks.find(candidate =>
            candidate.damageTrackId === interaction.damageTrackId);
        if (!track) return;
        if (isCumulativeSystemDamage(track)) {
            await this.setSystemDamageLevel(member, snapshot, track);
            return;
        }
        if (track.maximumHits === 1) {
            const pending = this.options.options().trackPhaseAndTurn;
            const hits = pending ? track.previewHits : track.committedHits;
            await this.dispatchDamageTrackDelta(member, track, hits > 0 ? -1 : 1, interaction.context);
            return;
        }
        this.openDamageTrackPicker(member, track, event, interaction.context);
    }

    private openDamageTrackPicker(
        member: CBTForceMember,
        track: NonMekRecordSheetDamageTrack,
        event: Event,
        context: UnitEditContext,
    ): void {
        const pending = this.options.options().trackPhaseAndTurn;
        const range = nonMekDamageTrackPickerRange(track, pending ? track.previewHits : track.committedHits);
        this.overlays.openNumberPicker(member.id, event, {
            min: range.min,
            max: range.max,
            selected: range.max >= 1 ? 1 : 0,
            title: track.label,
            targetType: 'motive',
            choices: recordSheetDamageChoices(range.min, range.max),
        }, delta => {
            if (delta !== 0) void this.dispatchDamageTrackDelta(member, track, delta, context);
        });
    }

    /** Clicking a counter stage fills up to it; clicking the highest hit stage steps back one level. */
    private async setSystemDamageLevel(
        member: CBTForceMember,
        snapshot: NonMekRecordSheetSnapshot,
        selected: NonMekRecordSheetDamageTrack,
    ): Promise<void> {
        const pending = this.options.options().trackPhaseAndTurn;
        const hits = (track: NonMekRecordSheetDamageTrack) => pending ? track.previewHits : track.committedHits;
        const activeLevel = snapshot.damageTracks
            .filter(track => track.system === selected.system && isCumulativeSystemDamage(track) && hits(track) > 0)
            .reduce((highest, track) => Math.max(highest, track.stage ?? 0), 0);
        const selectedLevel = selected.stage ?? 0;
        const level = activeLevel > selectedLevel
            ? selectedLevel
            : hits(selected) > 0 ? selectedLevel - 1 : selectedLevel;
        await this.overlays.dispatch(member, {
            type: 'set-system-damage-level',
            system: selected.system,
            level,
            target: pending ? 'pending' : 'committed',
            timestamp: Date.now(),
        }, snapshot.editContext);
    }

    private async dispatchDamageTrackDelta(
        member: CBTForceMember,
        track: NonMekRecordSheetDamageTrack,
        delta: number,
        context: UnitEditContext,
    ): Promise<boolean> {
        const snapshot = this.snapshot(member, context);
        if (!snapshot || delta === 0) return false;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        const command: CBTUnitCommand = delta > 0
            ? {
                type: 'damage-track',
                damageTrackId: track.damageTrackId,
                amount: delta,
                target,
                timestamp: Date.now(),
            }
            : {
                type: 'repair-damage-track',
                damageTrackId: track.damageTrackId,
                amount: -delta,
                target,
            };
        return await this.overlays.dispatch(member, command, context) !== null;
    }

    private openDamagePicker(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const range = nonMekDamagePickerRange(
            interaction,
            snapshot,
            this.options.options().trackPhaseAndTurn,
        );
        this.overlays.openNumberPicker(member.id, event, {
            min: range.min,
            max: range.max,
            threshold: range.threshold,
            selected: 0,
            title: range.title,
            targetType: 'armor',
            choices: recordSheetDamageChoices(range.min, range.max),
        }, delta => {
            if (delta !== 0) void this.dispatchDamage(member, interaction, delta);
        });
    }

    private async applyInfantryStrengthSelection(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'infantry-strength' }>,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
        const strength = interaction.strength;
        if (!location || !Number.isSafeInteger(strength)
            || strength < 1 || strength > location.maximumInternal) return;
        const pending = this.options.options().trackPhaseAndTurn;
        const remaining = pending ? location.previewRemainingInternal : location.remainingInternal;
        const nextRemaining = remaining >= strength ? strength - 1 : strength;
        const delta = remaining - nextRemaining;
        if (delta === 0) return;
        const accepted = await this.dispatchDelta(member, {
            kind: 'internal',
            locationId: interaction.locationId,
            context: snapshot.editContext,
        }, delta, pending ? 'pending' : 'committed');
        if (accepted) this.showDamageToast(member, interaction.locationId, delta);
    }

    private async dispatchDamage(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        delta: number,
    ): Promise<void> {
        const snapshot = this.snapshot(member, interaction.context);
        if (!snapshot) return;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        let context = interaction.context;
        for (const part of nonMekDamageParts(interaction, snapshot, delta, target === 'pending')) {
            const accepted = await this.dispatchDelta(member, { ...part.interaction, context }, part.delta, target);
            if (!accepted) return;
            context = accepted;
        }
        this.showDamageToast(
            member,
            interaction.locationId,
            delta,
            interaction.kind === 'armor' ? interaction.faceId : undefined,
        );
    }

    private dispatchDelta(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        delta: number,
        target: 'committed' | 'pending',
    ): Promise<UnitEditContext | null> {
        return this.overlays.dispatch(member, recordSheetDamageCommand(interaction, delta, target), interaction.context);
    }

    private showDamageToast(
        member: CBTForceMember,
        locationId: string,
        delta: number,
        armorFaceId?: string,
    ): void {
        const location = this.snapshot(member)?.locations.find(candidate => candidate.locationId === locationId);
        if (!location) return;
        const pending = this.options.options().trackPhaseAndTurn;
        const face = armorFaceId === undefined
            ? undefined
            : location.armor.find(candidate => candidate.faceId === armorFaceId);
        const locationCode = location.sheetCode || location.code;
        this.overlays.showDamageToast(member.id, delta, face ? {
            part: face.face === 'rear' ? 'rear armor' : 'armor',
            locationCode,
            remaining: pending ? face.previewRemaining : face.remaining,
            maximum: face.maximum,
            key: `armor-${face.faceId}`,
        } : {
            part: 'internal',
            locationCode,
            remaining: pending ? location.previewRemainingInternal : location.remainingInternal,
            maximum: location.maximumInternal,
            key: `internal-${location.locationId}`,
        });
    }

    private destroyBinding(unitId: string): void {
        this.overlays.clearUnitControls(unitId);
        const current = this.bound.get(unitId);
        if (!current) return;
        current.subscription.unsubscribe();
        for (const page of current.pages.values()) {
            page.binding.destroy();
            page.svg.classList.remove('interactive-sheet');
        }
        this.bound.delete(unitId);
    }
}

/** Map one shared crew-state menu selection to the sparse Entity command shape. */
export function nonMekCrewStateCommand(
    position: NonMekRecordSheetCrewPosition,
    controls: readonly CrewMemberState[],
    selected: string,
): CBTUnitCommand | null {
    const control = controls.find(key => key === selected);
    if (control !== 'unconscious'
        && control !== 'ejected'
        && control !== 'killed'
        && control !== 'stunned') return null;
    const active = CrewMember.from(position.state).hasState(control);
    return Object.freeze({
        type: 'set-crew-state',
        positionId: position.positionId,
        wounds: position.state.wounds,
        unconscious: control === 'unconscious' || control === 'stunned'
            ? !active
            : position.state.unconscious,
        ejected: control === 'ejected' ? !active : position.state.ejected,
        ...(control === 'killed' ? { dead: !active } : {}),
    });
}

export function nonMekDamageTrackPickerRange(
    track: NonMekRecordSheetDamageTrack,
    currentHits: number,
): Readonly<{ readonly min: number; readonly max: number }> {
    return Object.freeze({
        min: -currentHits,
        max: track.maximumHits - currentHits,
    });
}

export function nonMekDamagePickerRange(
    interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
    snapshot: NonMekRecordSheetSnapshot,
    pending: boolean,
): RecordSheetDamagePickerRange {
    const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
    if (!location) throw new Error(`Unknown Entity location ${interaction.locationId}`);
    if (interaction.kind === 'internal') {
        const remaining = pending ? location.previewRemainingInternal : location.remainingInternal;
        return {
            min: -(location.maximumInternal - remaining),
            max: remaining,
            title: `${location.sheetCode || location.code} Internal`,
        };
    }
    const face = location.armor.find(candidate => candidate.faceId === interaction.faceId);
    if (!face) throw new Error(`Unknown Entity armor face ${interaction.faceId}`);
    const remaining = pending ? face.previewRemaining : face.remaining;
    const internalRemaining = pending ? location.previewRemainingInternal : location.remainingInternal;
    // A Battle Armor trooper row is one track: its picker also repairs internal damage.
    const repairableInternal = location.combinedPips ? location.maximumInternal - internalRemaining : 0;
    return {
        min: -(face.maximum - remaining + repairableInternal),
        max: remaining + internalRemaining,
        threshold: remaining,
        title: `${location.sheetCode || location.code}${face.face === 'rear' ? ' (Rear)' : ''} Armor`,
    };
}

/**
 * Splits one picked damage (positive) or repair (negative) into ordered location commands.
 * Damage strikes armor first and the rest reaches internal structure. Repairs restore only
 * the picked part, except on a Battle Armor trooper row, which restores internal structure
 * before armor so its single picker undoes damage in reverse.
 */
export function nonMekDamageParts(
    interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
    snapshot: NonMekRecordSheetSnapshot,
    delta: number,
    pending: boolean,
): readonly Readonly<{
    interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>;
    delta: number;
}>[] {
    if (interaction.kind === 'internal') return delta === 0 ? [] : [{ interaction, delta }];
    const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
    const face = location?.armor.find(candidate => candidate.faceId === interaction.faceId);
    if (!location || !face) return [];
    const internal = { kind: 'internal' as const, locationId: location.locationId, context: interaction.context };
    const armorRemaining = pending ? face.previewRemaining : face.remaining;
    const internalRemaining = pending ? location.previewRemainingInternal : location.remainingInternal;
    const [first, firstAmount, second] = delta > 0
        ? [interaction, Math.min(delta, armorRemaining), internal] as const
        : location.combinedPips
            ? [internal, -Math.min(-delta, location.maximumInternal - internalRemaining), interaction] as const
            : [interaction, delta, internal] as const;
    return [
        { interaction: first, delta: firstAmount },
        { interaction: second, delta: delta - firstAmount },
    ].filter(part => part.delta !== 0);
}
