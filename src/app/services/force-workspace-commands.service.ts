// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable, Injector } from '@angular/core';
import { firstValueFrom, filter } from 'rxjs';

import { ASForce } from '../models/as-force.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import {
    Force,
    MAX_UNITS,
    type UnitGroup,
} from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import {
    forceMemberCommander,
    forceMemberSummary,
    isCBTForceMember,
    isCBTMekForceMember,
    type CBTForceMember,
    type CBTMekForceMember,
    type ForceMember,
} from '../models/force-member.model';
import type { UnitSummary } from '../models/unit-summary.model';
import {
    ConfirmDialogComponent,
    type ConfirmDialogData,
} from '../components/confirm-dialog/confirm-dialog.component';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceBuilderService } from './force-builder.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { ForceCrewTransferService } from './force-crew-transfer.service';
import { ForceFormationService } from './force-formation.service';
import {
    ForceUnitAdmissionService,
    type ForceUnitAdmission as ForceBuilderUnitAdmission,
} from './force-unit-admission.service';
import { GameService } from './game.service';
import { LayoutService } from './layout.service';
import { LoggerService } from './logger.service';
import { ToastService } from './toast.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

/** Owns force/member mutations; the workspace service owns only slots and selection. */
@Injectable({ providedIn: 'root' })
export class ForceWorkspaceCommandsService {
    private readonly builder = inject(ForceBuilderService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly dataService = inject(DataService);
    private readonly layoutService = inject(LayoutService);
    private readonly toastService = inject(ToastService);
    private readonly logger = inject(LoggerService);
    private readonly dialogsService = inject(DialogsService);
    private readonly injector = inject(Injector);
    private readonly unitAdmission = inject(ForceUnitAdmissionService);
    private readonly formations = inject(ForceFormationService);
    private readonly crewTransfers = inject(ForceCrewTransferService);

    async addUnit(
        unit: UnitSummary,
        gunnerySkill?: number,
        pilotingSkill?: number,
        group?: UnitGroup,
        gameSystemOverride?: GameSystem,
    ): Promise<ForceBuilderUnitAdmission | null> {
        const requestedGameSystem = gameSystemOverride
            ?? this.workspace.smartCurrentForce()?.gameSystem
            ?? this.injector.get(GameService).currentGameSystem();
        if (requestedGameSystem !== GameSystem.CLASSIC) {
            return this.addUnitCore(unit, gunnerySkill, pilotingSkill, group, gameSystemOverride);
        }

        const startedAt = Date.now();
        this.logger.info(`[Background:cbt-unit-admission] Started for "${unit.name}".`);
        try {
            const result = await this.addUnitCore(unit, gunnerySkill, pilotingSkill, group, gameSystemOverride);
            this.logger.info(
                `[Background:cbt-unit-admission] ${result ? 'Finished' : 'Stopped'} for "${unit.name}" in ${Math.max(0, Date.now() - startedAt)} ms.`,
            );
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `[Background:cbt-unit-admission] Failed for "${unit.name}" after ${Math.max(0, Date.now() - startedAt)} ms: ${message}`,
            );
            throw error;
        }
    }

    private async addUnitCore(
        unit: UnitSummary,
        gunnerySkill?: number,
        pilotingSkill?: number,
        group?: UnitGroup,
        gameSystemOverride?: GameSystem,
    ): Promise<ForceBuilderUnitAdmission | null> {
        let targetForce = this.workspace.smartCurrentForce();
        if (!targetForce) {
            targetForce = await this.builder.createNewForce('', gameSystemOverride);
            if (!targetForce) {
                return null;
            }
        }
        const selectedUnit = this.workspace.selectedUnit();
        const targetGroup = group ?? (targetForce === selectedUnit?.force && !isCBTForceMember(selectedUnit)
            ? selectedUnit.getGroup() ?? undefined
            : undefined);
        let admission: ForceBuilderUnitAdmission;
        try {
            admission = await this.unitAdmission.admit({
                force: targetForce,
                summary: unit,
                group: targetGroup,
                gunnerySkill,
                pilotingSkill,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `[Background:cbt-unit-admission] Admission rejected for "${unit.name}": ${message}`,
            );
            this.toastService.showToast(message, 'error');
            return null;
        }

        if (isCBTForceMember(admission)) {
            const roster = targetForce instanceof CBTForce
                ? targetForce.queryCanonicalRoster()
                : null;
            const firstUnit = roster?.kind === 'available'
                && roster.snapshot.structural.members.length === 1;
            if (firstUnit) {
                this.closeUnitSearchPanelsAfterFirstAdmission();
                this.layoutService.openMenu();
            }
            this.formations.generateFactionAndForceNameIfNeeded(targetForce, firstUnit);
            const unitGroup = targetForce.groups().find(candidate => candidate.id === admission.rosterGroupId);
            if (unitGroup) {
                await this.formations.applyFormationFilterToGroup(unitGroup, firstUnit);
                await this.formations.assignFormationIfNeeded(unitGroup);
            }
            this.workspace.selectUnit(admission);
            return admission;
        }

        const newForceUnit = admission;

        this.workspace.selectUnit(newForceUnit);
        const firstUnit = targetForce.units().length === 1;
        if (firstUnit) {
            this.closeUnitSearchPanelsAfterFirstAdmission();
            this.layoutService.openMenu();
        }
        const unitGroup = group ?? targetForce.groups().find(group => {
            return group.units().some(u => u.id === newForceUnit.id);
        });
        this.formations.generateFactionAndForceNameIfNeeded(targetForce, firstUnit);
        if (unitGroup) {
            await this.formations.applyFormationFilterToGroup(unitGroup, firstUnit);
            await this.formations.assignFormationIfNeeded(unitGroup);
        }
        return newForceUnit;
    }

    /** Resolve the search coordinator after startup so it cannot form a root DI cycle. */
    private closeUnitSearchPanelsAfterFirstAdmission(): void {
        this.injector.get(UnitSearchFiltersService, null)
            ?.requestClosePanels({ exitExpandedView: true });
    }

    /**
     * Sets the provided unit as the currently selected one.
     * @param unit The unit to select, or null to deselect.
     */
    selectUnit(unit: ForceMember | null) {
        this.workspace.selectedUnit.set(unit);
    }

    /**
     * Clones a unit and inserts the clone immediately after the original unit
     * in the same group. Pilot/crew data is not copied.
     */
    async cloneUnit(sourceUnit: ForceMember): Promise<ForceMember | null> {
        const force = sourceUnit.force;
        if (!force || force.readOnly()) return null;
        const unitData = isCBTForceMember(sourceUnit) ? sourceUnit.summary : sourceUnit.getSummary();
        if (!unitData) return null;

        if (isCBTForceMember(sourceUnit)) {
            try {
                if (!(force instanceof CBTForce)) throw new Error('Classic member has a non-Classic owner');
                const group = force.groups().find(candidate => candidate.id === sourceUnit.rosterGroupId);
                if (!group) return null;
                const sourceIndex = force.membersInGroup(group)
                    .findIndex(member => member.id === sourceUnit.id);
                if (sourceIndex < 0) return null;
                const clone = await this.unitAdmission.admit({
                    force,
                    summary: unitData,
                    rosterGroupId: sourceUnit.rosterGroupId,
                    rosterMemberIndex: sourceIndex + 1,
                });
                if (!isCBTForceMember(clone)) throw new Error('Classic clone returned an Alpha Strike unit');
                this.workspace.selectUnit(clone);
                return clone;
            } catch (error) {
                if (error instanceof Error && error.message.includes(`more than ${MAX_UNITS}`)) {
                    this.toastService.showToast(`Cannot clone unit. A force cannot contain more than ${MAX_UNITS} units.`, 'error');
                    return null;
                }
                throw error;
            }
        }

        const group = sourceUnit.getGroup();
        if (!group) return null;

        const units = group.units();
        const sourceIndex = units.findIndex(u => u.id === sourceUnit.id);
        if (sourceIndex === -1) return null;

        try {
            const newForceUnit = await this.unitAdmission.admit({
                force,
                summary: unitData,
                group,
            });
            if (isCBTForceMember(newForceUnit)) throw new Error('Alpha Strike clone returned a Classic runtime');
            // addUnit appends to end — move it to right after the source
            const updatedUnits = group.units();
            const newIndex = updatedUnits.findIndex(u => u.id === newForceUnit.id);
            if (newIndex !== sourceIndex + 1) {
                group.reorderUnit(newIndex, sourceIndex + 1);
            }

            this.workspace.selectUnit(newForceUnit);
            return newForceUnit;
        } catch (error) {
            if (error instanceof Error && error.message === `Cannot add more than ${MAX_UNITS} units to a single force`) {
                this.toastService.showToast(`Cannot clone unit. A force cannot contain more than ${MAX_UNITS} units.`, 'error');
                return null;
            }

            throw error;
        }
    }

    getNextUnit(forceUnit: ForceMember | null): ForceMember | null {
        if (!forceUnit?.force) {
            return null;
        }
        const units = forceUnit.force.members();
        if (!forceUnit || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === forceUnit.id);
        if (idx === -1) return null;

        const nextIndex = (idx + 1) % units.length;
        return units[nextIndex] ?? null;
    }

    getPreviousUnit(forceUnit: ForceMember | null): ForceMember | null {
        if (!forceUnit?.force) {
            return null;
        }
        const units = forceUnit.force.members();
        if (!forceUnit || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === forceUnit.id);
        if (idx === -1) return null;

        const prevIndex = (idx - 1 + units.length) % units.length;
        return units[prevIndex] ?? null;
    }

    /**
     * Selects the next unit in the force list.
     */
    selectNextUnit() {
        const nextUnit = this.getNextUnit(this.workspace.selectedUnit());
        if (nextUnit) {
            this.workspace.selectUnit(nextUnit);
        }
    }

    /**
     * Selects the previous unit in the force list.
     */
    selectPreviousUnit() {
        const prevUnit = this.getPreviousUnit(this.workspace.selectedUnit());
        if (prevUnit) {
            this.workspace.selectUnit(prevUnit);
        }
    }

    /**
     * Removes a unit from the force. If the removed unit was selected,
     * it selects the previous unit in the list.
     * @param unitToRemove The unit to remove.
     */
    async removeUnit(unitToRemove: ForceMember, skipConfirmation = false) {
        if (isCBTForceMember(unitToRemove)) {
            await this.removeClassicMember(unitToRemove, skipConfirmation);
            return;
        }
        const targetForce = unitToRemove.force;
        if (!targetForce || targetForce.readOnly() || !targetForce.isWholeOwnerActive()) return;
        const targetGroups = targetForce.groups();
        const ownerGroupIndex = targetGroups.findIndex(group => group.units().includes(unitToRemove));
        if (ownerGroupIndex < 0) return;
        const ownerGroup = targetGroups[ownerGroupIndex];
        const unitIndex = ownerGroup.units().indexOf(unitToRemove);
        if (unitIndex < 0) return;
        const unitId = unitToRemove.id;
        const authorityFingerprint = targetForce.captureWholeOwnerAuthorityFingerprint();
        if (unitToRemove.modified && !skipConfirmation) {
            const unitName = (unitToRemove.getSummary().chassis + ' ' + unitToRemove.getSummary().model).trim();
            const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
                panelClass: 'danger',
                data: <ConfirmDialogData<string>>{
                    title: `Delete Unit`,
                    message: `Removing will discard all marks on the sheet and permanently remove the unit "${unitName}" from the force.`,
                    buttons: [
                        { label: 'DELETE', value: 'delete', class: 'danger' },
                        { label: 'NO', value: 'cancel' }
                    ]
                }
            });
            const result = await firstValueFrom(dialogRef.closed);

            if (result !== 'delete') {
                return;
            }
        }

        const currentGroups = targetForce.groups();
        if (targetForce.readOnly()
            || !targetForce.isWholeOwnerActive()
            || !targetForce.isWholeOwnerAuthorityFingerprintCurrent(authorityFingerprint)
            || unitToRemove.force !== targetForce
            || unitToRemove.id !== unitId
            || currentGroups[ownerGroupIndex] !== ownerGroup
            || ownerGroup.force !== targetForce
            || ownerGroup.units()[unitIndex] !== unitToRemove) return;

        const currentUnits = targetForce.units();
        const isLastUnit = currentUnits.length === 1;
        const idx = currentUnits.indexOf(unitToRemove);
        if (idx < 0) return;

        // If this is the last unit, switch force/selection BEFORE removal
        if (isLastUnit) {
            await this.builder.deleteAndRemoveForce(targetForce);
            return;
        }

        targetForce.removeUnit(unitToRemove);
        this.dataService.deleteCanvasDataOfUnit(unitToRemove);

        if (this.workspace.selectedUnit() === unitToRemove) {
            const updatedUnits = targetForce.units();
            let newSelected: ASForceUnit | null = null;
            if (updatedUnits.length > 0) {
                newSelected = updatedUnits[Math.max(0, idx - 1)] ?? updatedUnits[0];
            }
            this.workspace.selectedUnit.set(newSelected);
        }

        this.formations.generateFactionAndForceNameIfNeeded(targetForce);
        if (targetForce.groups().includes(ownerGroup)) {
            await this.formations.assignFormationIfNeeded(ownerGroup);
        }
    }

    /**
     * Replaces a unit in the force with a new one, carrying over pilot info.
     * Shows a confirmation dialog warning about losing damage state.
     * @param originalUnit The Alpha Strike unit to replace
     * @param newUnitData The new Unit data to replace with
     * @returns The new Alpha Strike unit if successful, null if cancelled
     */
    async replaceAlphaStrikeUnit(
        originalUnit: ASForceUnit,
        newUnitData: UnitSummary,
    ): Promise<ASForceUnit | null> {
        const targetForce = originalUnit.force;
        if (!targetForce) {
            return null;
        }

        // Check if the original unit belongs to this force
        const allUnits = targetForce.units();
        if (!allUnits.some(u => u.id === originalUnit.id)) {
            this.toastService.showToast('Unit not found in current force.', 'error');
            return null;
        }

        // Build confirmation message
        const oldUnitName = `${originalUnit.getSummary().chassis} ${originalUnit.getSummary().model}`.trim();
        const newUnitName = `${newUnitData.chassis} ${newUnitData.model}`.trim();

        const result = await this.dialogsService.choose(
            'Change Unit',
            `Replace "${oldUnitName}" with "${newUnitName}"?\n\nThe new unit will be created fresh. Any damage or modifications on the current unit will be lost.\n\nPilot name and skills will be carried over.`,
            [
                { label: 'CHANGE', value: 'change', class: 'primary' },
                { label: 'CANCEL', value: 'cancel' }
            ],
            'cancel'
        );

        if (result !== 'change') {
            return null;
        }

        // Track if this unit was selected
        const wasSelected = this.workspace.selectedUnit()?.id === originalUnit.id;

        // Use the Force model's replaceUnit method for core logic
        let replaceResult: Awaited<ReturnType<ASForce['replaceUnit']>>;
        try {
            replaceResult = await targetForce.replaceUnit(originalUnit, newUnitData);
        } catch (error) {
            this.toastService.showToast(
                error instanceof Error ? error.message : 'Failed to prepare replacement unit.',
                'error',
            );
            return null;
        }

        if (!replaceResult) {
            this.toastService.showToast('Failed to replace unit.', 'error');
            return null;
        }

        const { newUnit: newForceUnit, group: originalGroup } = replaceResult;
        this.dataService.deleteCanvasDataOfUnit(originalUnit);

        // Select the new unit if the old one was selected
        if (wasSelected) {
            this.workspace.selectUnit(newForceUnit);
        }

        this.formations.generateFactionAndForceNameIfNeeded(targetForce);
        if (originalGroup) {
            await this.formations.assignFormationIfNeeded(originalGroup);
        }

        return newForceUnit;
    }

    public async requestCloneForce(force: Force): Promise<void> {
        if (!force) return;
        
        const isAlphaStrike = force.gameSystem === GameSystem.ALPHA_STRIKE;
        const targetSystemLabel = isAlphaStrike ? 'CBT' : 'AS';
        
        const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            data: {
                title: 'Clone/Convert Force',
                message: 'Create a separate, editable copy of this force. The original will remain unchanged.',
                buttons: [
                    { label: 'CLONE', value: 'clone', class: 'primary' },
                    { label: `CONVERT TO ${targetSystemLabel}`, value: 'convert' },
                    { label: 'DISMISS', value: 'cancel' }
                ]
            } as ConfirmDialogData<string>
        });
        
        const result = await firstValueFrom(dialogRef.closed);
        if (result === 'clone') {
            await this.cloneForce(force);
        } else if (result === 'convert') {
            await this.convertForce(force);
        }
    }

    private async cloneForce(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }

        const forceSlot = this.workspace.getForceSlot(force);
        if (!forceSlot) return false;
        const alignment = forceSlot.alignment;
        const sourceFingerprint = force.captureWholeOwnerAuthorityFingerprint();

        const selectedIdx = force.members().findIndex(member => member.id === this.workspace.selectedUnit()?.id);
        const cloned = await force.cloneForPersistence();
        if (this.workspace.getForceSlot(force) !== forceSlot
            || !force.isWholeOwnerAuthorityFingerprintCurrent(sourceFingerprint)) {
            this.destroyDetachedForceUnits(cloned);
            return false;
        }

        // Unload old, load clone
        const removed = await this.builder.removeLoadedForce(force, { skipPrompt: true });
        if (!removed) {
            this.destroyDetachedForceUnits(cloned);
            return false;
        }
        // Load the new force (this handles URL state and other housekeeping)
        if (!this.builder.addLoadedForce(cloned, alignment, { activate: true })) {
            this.destroyDetachedForceUnits(cloned);
            return false;
        }
        const units = cloned.members();
        this.workspace.selectUnit(selectedIdx >= 0 && selectedIdx < units.length ? units[selectedIdx] : units[0] ?? null);

        await this.dataService.saveForceAndWaitForCloud(cloned);
        this.toastService.showToast(`A copy of this force was created and saved. You can now edit the copy without affecting the original.`, 'success');
        return true;
    }

    /**
     * Converts the current force to the opposite game system (CBT <-> Alpha Strike).
     * Creates a new force with the same name and groups, but fresh units without state.
     */
    private async convertForce(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }

        const isAlphaStrike = force.gameSystem === GameSystem.ALPHA_STRIKE;
        const targetSystemLabel = isAlphaStrike ? 'Classic BattleTech' : 'Alpha Strike';

        const forceSlot = this.workspace.getForceSlot(force);
        if (!forceSlot) return false;
        const alignment = forceSlot.alignment;
        const sourceFingerprint = force.captureWholeOwnerAuthorityFingerprint();

        // Create new force with opposite game system
        const newForce: Force = isAlphaStrike
            ? new CBTForce(force.name, this.dataService, this.injector)
            : new ASForce(force.name, this.dataService, this.injector);

        newForce.setNote(force.note, false);
        newForce.setTags(force.tags, false);
        newForce.faction.set(force.faction());
        newForce.factionLock = force.factionLock;
        newForce.era.set(force.era());
        newForce.eraLock = force.eraLock;
        newForce.loading = true;

        try {
            // Recreate groups and units - process one canonical group at a time.
            for (const sourceGroup of force.groups()) {
                const newGroup = await newForce.addGroup();
                if (!await newForce.updateGroup(newGroup, {
                    name: sourceGroup.name() ?? null,
                    color: sourceGroup.color ?? null,
                    formation: sourceGroup.formation(),
                    formationLock: sourceGroup.formationLock === true,
                })) {
                    throw new Error(`Could not copy force group ${sourceGroup.id}`);
                }
                if (!newGroup.formationLock && sourceGroup.formation()) {
                    newGroup.formationHistory.add(sourceGroup.formation()!.id);
                }

                for (const sourceUnit of force.membersInGroup(sourceGroup)) {
                    const newForceUnit = await this.unitAdmission.admit({
                        force: newForce,
                        summary: forceMemberSummary(sourceUnit),
                        group: newGroup,
                        commander: forceMemberCommander(sourceUnit),
                    });

                    // Transfer pilot data cross-system
                    await this.crewTransfers.transferCrossSystem(
                        sourceUnit,
                        newForceUnit,
                        force.gameSystem,
                        newForce.gameSystem,
                    );
                }

                await this.formations.assignFormationIfNeeded(newGroup); // re-evaluate after conversion because the unit type changed
            }
        } finally {
            newForce.loading = false;
        }

        if (this.workspace.getForceSlot(force) !== forceSlot
            || !force.isWholeOwnerAuthorityFingerprintCurrent(sourceFingerprint)) {
            this.destroyDetachedForceUnits(newForce);
            return false;
        }
        const removed = await this.builder.removeLoadedForce(force);
        if (!removed) {
            this.destroyDetachedForceUnits(newForce);
            return false;
        }
        // Load the new force (this handles URL state and other housekeeping)
        if (!this.builder.addLoadedForce(newForce, alignment, { activate: true })) {
            this.destroyDetachedForceUnits(newForce);
            return false;
        }
        await this.dataService.saveForceAndWaitForCloud(newForce);

        this.toastService.showToast(`Force converted to ${targetSystemLabel} and saved.`, 'success');
        return true;
    }

    /**
     * Converts a ForceUnit to be compatible with a target force of a different game system.
     * Creates a new ForceUnit and transfers pilot/crew data cross-system.
     * @returns The converted ForceUnit (not yet added to any group), or null if the unit data wasn't found.
     */
    async convertUnitForForce(
        sourceUnit: ASForceUnit,
        sourceForce: Force,
        targetForce: Force,
    ): Promise<ASForceUnit | null> {
        const unitName = sourceUnit.getSummary()?.name;
        if (!unitName) return null;
        const unitData = this.dataService.getUnitByName(unitName);
        if (!unitData) return null;
        if (!(targetForce instanceof ASForce)) {
            throw new Error('Classic units must be admitted from their canonical native source.');
        }
        const newUnit = targetForce.createCompatibleUnit(unitData);
        try {
            newUnit.disabledSaving = true;
            try {
                await this.crewTransfers.transferCrossSystem(
                    sourceUnit,
                    newUnit,
                    sourceForce.gameSystem,
                    targetForce.gameSystem,
                );
            } finally {
                newUnit.disabledSaving = false;
            }
            return newUnit;
        } catch (error) {
            newUnit.destroy();
            throw error;
        }
    }

    private async removeClassicMember(
        member: CBTForceMember,
        skipConfirmation: boolean,
    ): Promise<void> {
        const force = member.force;
        if (force.readOnly() || !force.isWholeOwnerActive()) return;
        const members = force.members();
        const index = members.findIndex(candidate => candidate.id === member.id);
        if (index < 0) return;
        const group = force.groups().find(candidate => candidate.id === member.rosterGroupId);
        if (!group) return;
        const authority = force.captureWholeOwnerAuthorityFingerprint();
        if (!skipConfirmation) {
            const confirmed = await this.dialogsService.requestConfirmation(
                `Removing will discard all runtime state and permanently remove "${member.summary.chassis} ${member.summary.model}" from the force.`,
                'Delete Unit',
                'danger',
            );
            if (!confirmed) return;
        }
        if (!force.isWholeOwnerAuthorityFingerprintCurrent(authority)
            || force.getClassicMember(member.id) !== member) return;
        if (members.length === 1) {
            await this.builder.deleteAndRemoveForce(force);
            return;
        }
        const result = await force.removeClassicMember(member.id);
        if (!result.accepted) {
            this.toastService.showToast(`Unable to remove unit: ${result.reason}`, 'error');
            return;
        }
        if (this.workspace.selectedUnit() === member) {
            const remaining = force.members();
            this.workspace.selectUnit(remaining[Math.max(0, index - 1)] ?? remaining[0] ?? null);
        }
        this.formations.generateFactionAndForceNameIfNeeded(force);
        if (force.groups().includes(group)) await this.formations.assignFormationIfNeeded(group);
    }

    public async repairUnit(member: ForceMember): Promise<boolean> {
        const summary = forceMemberSummary(member);
        const label = `${summary.chassis} ${summary.model}`.trim();
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to repair the unit "${label}"? This will reset all damage and status effects.`,
            `Repair ${summary.chassis}`,
            'info',
        );
        if (!confirmed) return false;

        if (isCBTForceMember(member)) {
            const repaired = await member.force.repairMember(member.id);
            if (!repaired.accepted) {
                this.toastService.showToast(`Could not repair unit: ${repaired.reason}`, 'error');
                return false;
            }
        } else {
            member.repairAll();
        }
        this.toastService.showToast(`Repaired unit ${label}.`, 'success');
        return true;
    }

    public async repairAllUnits(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to repair all units? This will reset all damage and status effects on every unit in the force.',
            'Repair All Units',
            'info');
        if (confirmed) {
            if (force instanceof CBTForce) {
                const repaired = await force.repairAllMembers();
                if (!repaired.accepted) {
                    this.toastService.showToast(`Could not repair force: ${repaired.reason}`, 'error');
                    return false;
                }
            } else {
                force.units().forEach(unit => unit.repairAll());
            }
            return true;
        };
        return false;
    }

    public async removeGroup(group: UnitGroup): Promise<void> {
        const force = group.force;
        if (!force) {
            return;
        }
        const groupIndex = force.groups().indexOf(group);
        if (groupIndex < 0 || force.readOnly() || !force.isWholeOwnerActive()) return;
        const groupId = group.id;
        const authorityFingerprint = force.captureWholeOwnerAuthorityFingerprint();
        const groupMembers = force.members().filter(member => isCBTForceMember(member)
            ? member.rosterGroupId === group.id
            : group.units().includes(member));
        const unitCount = groupMembers.length;
        if (unitCount > 0) {       
            const groupLabel = group.name() || group.formationDisplayName() || 'this group';
            const confirmed = await this.dialogsService.requestConfirmation(
                `"${groupLabel}" contains ${unitCount} unit${unitCount > 1 ? 's' : ''}. Removing the group will permanently delete all units inside it.`,
                'Remove Group',
                'danger'
            );
            if (!confirmed) {
                return;
            }
        }
        const currentGroups = force.groups();
        if (force.readOnly()
            || !force.isWholeOwnerActive()
            || !force.isWholeOwnerAuthorityFingerprintCurrent(authorityFingerprint)
            || group.force !== force
            || group.id !== groupId
            || currentGroups[groupIndex] !== group) return;
        // If selected unit is in this group, move selection
        const selectedUnit = this.workspace.selectedUnit();
        if (selectedUnit && (isCBTForceMember(selectedUnit)
            ? selectedUnit.force === force && selectedUnit.rosterGroupId === group.id
            : group.units().includes(selectedUnit))) {
            const groupUnits = new Set(group.units());
            const otherUnits = force.members().filter(unit => isCBTForceMember(unit)
                ? unit.rosterGroupId !== group.id
                : !groupUnits.has(unit));
            this.workspace.selectedUnit.set(otherUnits[0] ?? null);
        }
        await force.removeGroup(group);
    }

    private destroyDetachedForceUnits(force: Force): void {
        let units: readonly ForceUnit[];
        try {
            units = force.units();
        } catch {
            return;
        }
        for (const unit of units) {
            try {
                unit.destroy();
            } catch {
                // Detached cleanup is best-effort.
            }
        }
    }

}
