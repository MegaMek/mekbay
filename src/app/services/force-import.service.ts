// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import {
    Force,
    MAX_GROUPS,
    MAX_UNITS,
    type UnitGroup,
} from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import { LoadForceEntry } from '../models/load-force-entry.model';
import {
    forceMemberCommander,
    isCBTForceMember,
    resolveForceMemberCatalogSummary,
    type ForceMember,
} from '../models/force-member.model';
import { LoadOperationEntry } from '../models/operation.model';
import type { ForceAlignment } from '../models/force-slot.model';
import { ForceLoadDialogComponent, type ForceLoadDialogResult } from '../components/force-load-dialog/force-load-dialog.component';
import { ForcePackDialogComponent, type ForcePackDialogResult } from '../components/force-pack-dialog/force-pack-dialog.component';
import type { SearchForceGeneratorDialogResult } from '../components/search-force-generator-dialog/search-force-generator-dialog.component';
import type { DialogRef } from './dialogs.service';
import { DialogsService } from './dialogs.service';
import { DataService } from './data.service';
import { ForceBuilderService } from './force-builder.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { ForceUnitLoadingService } from './force-unit-loading.service';
import { ForceCrewTransferService } from './force-crew-transfer.service';
import { ForceFormationService } from './force-formation.service';
import { ForceOperationService } from './force-operation.service';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { GameService } from './game.service';
import { ToastService } from './toast.service';
import type { ResolvedPack } from '../utils/force-pack.util';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';

/** Owns force generation and import workflows; ForceBuilder only owns the live workspace. */
@Injectable({ providedIn: 'root' })
export class ForceImportService {
    private readonly builder = inject(ForceBuilderService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly unitLoading = inject(ForceUnitLoadingService);
    private readonly dataService = inject(DataService);
    private readonly dialogs = inject(DialogsService);
    private readonly toast = inject(ToastService);
    private readonly router = inject(Router);
    private readonly injector = inject(Injector);
    private readonly admission = inject(ForceUnitAdmissionService);
    private readonly formations = inject(ForceFormationService);
    private readonly operations = inject(ForceOperationService);
    private readonly crewTransfers = inject(ForceCrewTransferService);
    private readonly game = inject(GameService);

    async loadForceEntry(
        entry: LoadForceEntry,
        mode: 'load' | 'add' | 'insert',
        alignment: ForceAlignment = 'friendly',
        { activate = true }: { activate?: boolean } = {},
    ): Promise<boolean> {
        if (mode === 'insert') {
            const targetForce = this.workspace.smartCurrentForce();
            if (!targetForce || targetForce.readOnly()) {
                this.toast.showToast('No editable force to insert into.', 'error');
                return false;
            }
            const sourceForce = await this.dataService.getForce(entry.instanceId, false);
            if (!sourceForce) {
                this.toast.showToast('Failed to load force.', 'error');
                return false;
            }
            return this.insertForceInto(sourceForce, targetForce);
        }

        const requestedForce = await this.dataService.getForce(entry.instanceId, false);
        if (!requestedForce) {
            this.toast.showToast('Failed to load force.', 'error');
            return false;
        }
        return mode === 'add'
            ? this.builder.addForce(requestedForce, alignment, { activate })
            : this.builder.loadForce(requestedForce);
    }

    async createGeneratedForce(entry: LoadForceEntry): Promise<Force | null> {
        const loadUnits = entry.groups.flatMap(group => group.units).filter(loadUnit => loadUnit.unit !== undefined);
        if (loadUnits.length === 0) return null;

        const force = await this.builder.createNewForce(entry.name, entry.type);
        if (!force) return null;

        let firstCreatedUnit: ForceMember | null = null;
        force.loading = true;
        force.factionLock = true;
        force.eraLock = true;
        try {
            force.faction.set(entry.faction ?? null);
            force.era.set(entry.era ?? null);

            for (const groupEntry of entry.groups) {
                const targetGroup = await force.addGroup(groupEntry.name || undefined);
                const previewFormation = groupEntry.formationId
                    ? LanceTypeIdentifierUtil.getDefinitionById(groupEntry.formationId, entry.type)
                    : null;
                await force.updateGroup(targetGroup, {
                    formation: previewFormation,
                    formationLock: true,
                });
                for (const loadUnit of groupEntry.units) {
                    if (!loadUnit.unit) continue;
                    const createdUnit = await this.admission.admit({
                        force,
                        summary: loadUnit.unit,
                        group: targetGroup,
                        gunnerySkill: entry.type === GameSystem.ALPHA_STRIKE
                            ? (loadUnit.skill ?? loadUnit.gunnery)
                            : loadUnit.gunnery,
                        pilotingSkill: loadUnit.piloting,
                        commander: loadUnit.commander,
                    });
                    if (!createdUnit) continue;
                    await this.crewTransfers.applyGeneratedOverrides(createdUnit, loadUnit);
                    firstCreatedUnit ??= createdUnit;
                }

                targetGroup.formationHistory.clear();
                await force.updateGroup(targetGroup, {
                    formation: previewFormation,
                    formationLock: false,
                });
                if (previewFormation) targetGroup.formationHistory.add(previewFormation.id);
                this.formations.reconcileASFormationAssignments(targetGroup);
                if (force.membersInGroup(targetGroup).length === 0) {
                    await force.removeGroup(targetGroup);
                }
            }

            if (force.name !== entry.name) force.setName(entry.name, false);
            force.faction.set(entry.faction ?? null);
            force.era.set(entry.era ?? null);
            if (!(force instanceof CBTForce)) force.removeEmptyGroups();
        } finally {
            force.factionLock = false;
            force.eraLock = false;
            force.loading = false;
        }

        this.workspace.selectUnit(firstCreatedUnit);
        return force;
    }

    async showLoadForceDialog(options?: { initialTab?: string }): Promise<void> {
        const ref = this.dialogs.createDialog<ForceLoadDialogResult>(ForceLoadDialogComponent, {
            data: options ?? undefined,
        });
        const envelope = await firstValueFrom(ref.closed);
        if (!envelope) return;
        const { result, mode, alignment } = envelope;

        if (mode === 'operation' && result instanceof LoadOperationEntry) {
            await this.operations.loadOperation(result.operationId);
            return;
        }

        if (mode === 'insert') {
            const targetForce = this.workspace.smartCurrentForce();
            if (!targetForce || targetForce.readOnly()) {
                this.toast.showToast('No editable force to insert into.', 'error');
                return;
            }
            if (result instanceof Force) {
                await this.insertForceInto(result, targetForce);
            } else if (result instanceof LoadForceEntry) {
                const forceToInsert = await this.dataService.getForce(result.instanceId, false);
                if (!forceToInsert) {
                    this.toast.showToast('Failed to load force.', 'error');
                    return;
                }
                await this.insertForceInto(forceToInsert, targetForce);
            } else {
                const pack = result as ResolvedPack;
                if (pack.units?.length) await this.insertPackInto(pack, targetForce);
            }
            return;
        }

        const isAdd = mode === 'add';
        const addAlignment: ForceAlignment = alignment ?? 'friendly';
        if (result instanceof Force) {
            if (isAdd) await this.builder.addForce(result, addAlignment);
            else await this.builder.loadForce(result);
            return;
        }
        if (result instanceof LoadForceEntry) {
            const requestedForce = await this.dataService.getForce(result.instanceId, false);
            if (!requestedForce) {
                this.toast.showToast('Failed to load force.', 'error');
                return;
            }
            if (isAdd) await this.builder.addForce(requestedForce, addAlignment);
            else await this.builder.loadForce(requestedForce);
            return;
        }

        const pack = result as ResolvedPack;
        if (!pack.units?.length) return;
        if (isAdd) {
            const newForce = this.game.currentGameSystem() === GameSystem.ALPHA_STRIKE
                ? new ASForce('', this.dataService, this.injector)
                : new CBTForce('', this.dataService, this.injector);
            if (!await this.builder.addForce(newForce, addAlignment)) return;
            const group = await newForce.addGroup();
            for (const unit of pack.units) {
                if (!unit?.unit) continue;
                await this.admission.admit({ force: newForce, summary: unit.unit, group });
            }
            await this.unitLoading.load([newForce]);
            this.workspace.selectUnit(newForce.members()[0] ?? null);
            return;
        }

        const newForce = await this.builder.createNewForce();
        if (!newForce) {
            this.toast.showToast('Failed to create new force.', 'error');
            return;
        }
        const group = await newForce.addGroup();
        for (const unit of pack.units) {
            if (!unit?.unit) continue;
            await this.admission.admit({ force: newForce, summary: unit.unit, group });
        }
        await this.unitLoading.load([newForce]);
        this.workspace.selectUnit(newForce.members()[0] ?? null);
    }

    async showForcePackDialog(): Promise<void> {
        const targetForce = this.workspace.smartCurrentForce();
        if (!targetForce) {
            this.toast.showToast('No active force to add units to.', 'error');
            return;
        }
        const ref = this.dialogs.createDialog<ForcePackDialogResult>(ForcePackDialogComponent);
        const units = await firstValueFrom(ref.closed);
        if (!units?.length) return;
        const group = await targetForce.addGroup();
        for (const entry of units) {
            if (!entry?.unit) continue;
            await this.admission.admit({ force: targetForce, summary: entry.unit, group });
        }
    }

    async showSearchForceGeneratorDialog(options: { importCurrentForce?: boolean } = {}): Promise<void> {
        if (!this.dataService.isDataReady()) {
            this.toast.showToast('Data is still loading.', 'info');
            return;
        }
        await this.router.navigate(['/forcegenerator'], {
            queryParamsHandling: 'preserve',
            state: { importCurrentForce: options.importCurrentForce === true },
        });
    }

    async openSearchForceGeneratorDialog(options: { importCurrentForce?: boolean } = {}): Promise<DialogRef | null> {
        const megaMekDataReady = await this.dataService.ensureMegaMekCatalogsInitialized();
        if (!megaMekDataReady) {
            this.toast.showToast('MegaMek force generator data could not be loaded.', 'error');
            return null;
        }
        const { SearchForceGeneratorDialogComponent } = await import('../components/search-force-generator-dialog/search-force-generator-dialog.component');
        const dialogRef = this.dialogs.createDialog<SearchForceGeneratorDialogResult | null>(SearchForceGeneratorDialogComponent, {
            disableClose: true,
            data: { importCurrentForce: options.importCurrentForce === true },
        });
        void firstValueFrom(dialogRef.closed).then(result => this.finalizeGeneratedForceDialog(result ?? null));
        return dialogRef;
    }

    private async finalizeGeneratedForceDialog(
        result: { forceEntry: LoadForceEntry; config: { gameSystem: GameSystem }; totalCost: number } | null,
    ): Promise<void> {
        const unitCount = result?.forceEntry.groups.reduce(
            (sum, group) => sum + group.units.filter(unitEntry => unitEntry.unit).length,
            0,
        ) ?? 0;
        if (!result || unitCount === 0) return;
        const force = await this.createGeneratedForce(result.forceEntry);
        if (!force) {
            this.toast.showToast('Failed to generate a new force.', 'error');
            return;
        }
        const budgetMetric = result.config.gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
        this.toast.showToast(
            `Generated ${unitCount} units for ${result.forceEntry.faction?.name ?? 'Unknown Faction'} (${budgetMetric} ${result.totalCost.toLocaleString()}).`,
            'info',
        );
    }

    private async insertForceInto(sourceForce: Force, targetForce: Force): Promise<boolean> {
        const sourceGroups = sourceForce.groups();
        const sourceUnitCount = sourceForce.members().length;
        const newGroupCount = targetForce.groups().length + sourceGroups.length;
        const newUnitCount = targetForce.members().length + sourceUnitCount;
        if (newGroupCount > MAX_GROUPS) {
            await this.dialogs.showError(
                `Cannot insert: the result would have ${newGroupCount} groups, exceeding the limit of ${MAX_GROUPS}.`,
                'Insert Failed',
            );
            return false;
        }
        if (newUnitCount > MAX_UNITS) {
            await this.dialogs.showError(
                `Cannot insert: the result would have ${newUnitCount} units, exceeding the limit of ${MAX_UNITS}.`,
                'Insert Failed',
            );
            return false;
        }

        const needsConversion = sourceForce.gameSystem !== targetForce.gameSystem;
        let insertedCount = 0;
        const newGroups: UnitGroup[] = [];
        for (const sourceGroup of sourceGroups) {
            const newGroup = await targetForce.addGroup(sourceGroup.name());
            await targetForce.updateGroup(newGroup, {
                formation: sourceGroup.formation(),
                formationLock: sourceGroup.formationLock === true,
            });
            if (!newGroup.formationLock && sourceGroup.formation()) {
                newGroup.formationHistory.add(sourceGroup.formation()!.id);
            }
            for (const sourceUnit of sourceForce.membersInGroup(sourceGroup)) {
                let created: ForceMember | null = null;
                if (isCBTForceMember(sourceUnit)
                    && targetForce instanceof CBTForce
                    && !needsConversion) {
                    const identity = sourceUnit.force.getUnitSourceIdentity(sourceUnit.id);
                    if (identity) {
                        created = await this.admission.admitClassicIdentity({
                            force: targetForce,
                            identity,
                            group: newGroup,
                            commander: forceMemberCommander(sourceUnit),
                        });
                    }
                } else {
                    const unitData = resolveForceMemberCatalogSummary(
                        sourceUnit,
                        (provider, uuid) => this.dataService.getUnitByIdentity(provider, uuid),
                    );
                    if (unitData) {
                        created = await this.admission.admit({
                            force: targetForce,
                            summary: unitData,
                            group: newGroup,
                            commander: forceMemberCommander(sourceUnit),
                        });
                    }
                }
                if (!created) continue;
                if (needsConversion) {
                    await this.crewTransfers.transferCrossSystem(
                        sourceUnit,
                        created,
                        sourceForce.gameSystem,
                        targetForce.gameSystem,
                    );
                } else {
                    await this.crewTransfers.transferSameSystem(sourceUnit, created, targetForce.gameSystem);
                }
                insertedCount++;
            }
            newGroups.push(newGroup);
        }

        this.formations.generateFactionAndForceNameIfNeeded(targetForce);
        for (const group of newGroups) await this.formations.assignFormationIfNeeded(group);
        const systemNote = needsConversion ? ' (units were converted)' : '';
        this.toast.showToast(
            `Inserted ${insertedCount} unit(s) from "${sourceForce.displayName()}" into "${targetForce.displayName()}"${systemNote}.`,
            'success',
        );
        return true;
    }

    private async insertPackInto(pack: ResolvedPack, targetForce: Force): Promise<boolean> {
        const packUnitCount = pack.units.filter(unit => !!unit?.unit).length;
        const targetUnitCount = targetForce.members().length;
        const targetGroupCount = targetForce.groups().length;
        if (targetGroupCount + 1 > MAX_GROUPS) {
            await this.dialogs.showError(
                `Cannot insert: the force already has ${targetGroupCount} groups, adding another would exceed the limit of ${MAX_GROUPS}.`,
                'Insert Failed',
            );
            return false;
        }
        if (targetUnitCount + packUnitCount > MAX_UNITS) {
            await this.dialogs.showError(
                `Cannot insert: the result would have ${targetUnitCount + packUnitCount} units, exceeding the limit of ${MAX_UNITS}.`,
                'Insert Failed',
            );
            return false;
        }

        const newGroup = await targetForce.addGroup();
        for (const entry of pack.units) {
            if (!entry?.unit) continue;
            await this.admission.admit({ force: targetForce, summary: entry.unit, group: newGroup });
        }
        this.formations.generateFactionAndForceNameIfNeeded(targetForce);
        await this.formations.assignFormationIfNeeded(newGroup);
        this.toast.showToast(
            `Inserted ${packUnitCount} unit(s) from pack "${pack.name}" into "${targetForce.displayName()}".`,
            'success',
        );
        return true;
    }
}
