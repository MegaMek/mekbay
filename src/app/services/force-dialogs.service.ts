// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ApplicationRef, inject, Injectable, Injector } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { firstValueFrom, filter, map, take, type Observable } from 'rxjs';

import { ConfirmDialogComponent, type ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import {
    RenameForceDialogComponent,
    type RenameForceDialogData,
    type RenameForceDialogResult,
} from '../components/rename-force-dialog/rename-force-dialog.component';
import {
    RenameGroupDialogComponent,
    type RenameGroupDialogData,
    type RenameGroupDialogResult,
} from '../components/rename-group-dialog/rename-group-dialog.component';
import { ShareForceDialogComponent } from '../components/share-force-dialog/share-force-dialog.component';
import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import type { Force, UnitGroup } from '../models/force.model';
import type { PrintAllOptions } from '../models/print-options.model';
import { ASPrintUtil } from '../utils/asprint.util';
import { ASSummaryPrintUtil } from '../utils/as-summary-print.util';
import { CBTPrintUtil } from '../utils/cbtprint.util';
import { CBTSummaryPrintUtil } from '../utils/cbt-summary-print.util';
import { AsAbilityLookupService } from './as-ability-lookup.service';
import { ForcePersistenceService } from './force-persistence.service';
import { DialogsService, type DialogRef } from './dialogs.service';
import { ForceFormationService } from './force-formation.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { RecordSheetSourceService } from './record-sheet-source.service';
import { ToastService } from './toast.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';

/** Owns force dialogs, printing, naming, and save-confirmation interactions. */
@Injectable({ providedIn: 'root' })
export class ForceDialogsService {
    private readonly forcePersistence = inject(ForcePersistenceService);
    private readonly dialogs = inject(DialogsService);
    private readonly formations = inject(ForceFormationService);
    private readonly injector = inject(Injector);
    private readonly logger = inject(LoggerService);
    private readonly options = inject(OptionsService);
    private readonly recordSheets = inject(RecordSheetSourceService);
    private readonly router = inject(Router);
    private readonly toast = inject(ToastService);
    private readonly workspace = inject(ForceWorkspaceStateService);

    shareForce(force: Force | null): void {
        if (!force) return;
        this.dialogs.createDialog(ShareForceDialogComponent, { data: { force } });
    }

    async showForceOverview(force: Force): Promise<void> {
        const { ForceOverviewDialogComponent } = await import('../components/force-overview-dialog/force-overview-dialog.component');
        this.dialogs.createDialog(ForceOverviewDialogComponent, { data: { force } });
    }

    showC3Network(force: Force): void {
        void this.openC3Network(force, force.readOnly());
    }

    async showForceOrgDialog(organizationId?: string): Promise<{ closed: Observable<void> }> {
        await this.router.navigate(['/toe'], {
            queryParams: { toe: organizationId ?? null },
            queryParamsHandling: 'merge',
        });
        return {
            closed: this.router.events.pipe(
                filter((event): event is NavigationEnd => event instanceof NavigationEnd),
                filter(event => !event.urlAfterRedirects.startsWith('/toe')),
                take(1),
                map(() => undefined as void),
            ),
        };
    }

    async openForceOrgDialog(organizationId?: string): Promise<DialogRef> {
        const { ForceOrgDialogComponent } = await import('../components/force-org-dialog/force-org-dialog.component');
        return this.dialogs.createDialog(ForceOrgDialogComponent, {
            data: organizationId ? { organizationId } : undefined,
            panelClass: 'force-org-dialog-panel',
        });
    }

    async printAll(force: Force | null): Promise<void> {
        if (!force) return;
        const { PrintOptionsDialogComponent } = await import('../components/print-options-dialog/print-options-dialog.component');
        const ref = this.dialogs.createDialog<PrintAllOptions | null>(PrintOptionsDialogComponent, {
            disableClose: false,
            data: {
                gameSystem: force instanceof CBTForce ? GameSystem.CBT : GameSystem.AS,
                printSummary: async (printOptions: PrintAllOptions) => {
                    if (force instanceof CBTForce) {
                        await CBTSummaryPrintUtil.print(force, printOptions, true, this.options.options().displayUnitNameFormat);
                    } else if (force instanceof ASForce) {
                        await ASSummaryPrintUtil.print(
                            force,
                            this.injector.get(AsAbilityLookupService),
                            this.options.options().ASUseHex,
                            printOptions,
                            true,
                            this.options.options().displayUnitNameFormat,
                        );
                    }
                },
            },
        });
        const printOptions = await firstValueFrom(ref.closed);
        if (!printOptions) return;

        if (force instanceof CBTForce) {
            await CBTPrintUtil.multipagePrint(force.getCBTMembers(), printOptions, this.recordSheets);
        } else if (force instanceof ASForce) {
            await ASPrintUtil.multipagePrint(
                this.injector.get(ApplicationRef),
                this.injector,
                this.options,
                force.groups(),
                printOptions,
                true,
            );
        }
    }

    async promptChangeForceName(force: Force): Promise<void> {
        const result = await firstValueFrom(this.dialogs.createDialog<RenameForceDialogResult | null>(
            RenameForceDialogComponent,
            { data: { force } as RenameForceDialogData },
        ).closed);
        if (result) this.applyRenameForceDialogResult(force, result);
    }

    async saveForceWithNameConfirmation(force: Force): Promise<boolean> {
        const result = await firstValueFrom(this.dialogs.createDialog<RenameForceDialogResult | null>(
            RenameForceDialogComponent,
            { data: { force, hideUnset: true } as RenameForceDialogData },
        ).closed);
        if (!result) return false;
        this.applyRenameForceDialogResult(force, result);
        try {
            await this.forcePersistence.saveForce(force);
            this.toast.showToast('Force saved successfully.', 'success');
            return true;
        } catch (error) {
            this.logger.error(`Error saving force: ${error}`);
            this.toast.showToast('Failed to save force.', 'error');
            return false;
        }
    }

    async promptChangeGroupName(group: UnitGroup): Promise<void> {
        const result = await firstValueFrom(this.dialogs.createDialog<RenameGroupDialogResult | null>(
            RenameGroupDialogComponent,
            { data: { group } as RenameGroupDialogData },
        ).closed);
        if (result == null) return;

        if (result.action === 'unset') {
            group.formationHistory.clear();
            await group.force.updateGroup(group, {
                name: null,
                formation: null,
                formationLock: false,
            });
            await this.formations.assignFormationIfNeeded(group);
            return;
        }
        if (result.action !== 'confirm') return;
        group.formationHistory.clear();
        await group.force.updateGroup(group, {
            name: result.name || null,
            formation: result.formation,
            formationLock: result.formation !== null,
        });
        await this.formations.assignFormationIfNeeded(group);
    }

    async promptSaveForceIfNeeded(force: Force): Promise<boolean> {
        if (this.forcePersistence.hasDurableForceIdentity(force)
            || force.members().length === 0) return true;
        const result = await firstValueFrom(this.dialogs.createDialog<string>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<string>>{
                title: 'Unsaved Force',
                message: 'You have an unsaved force. Do you want to save it before proceeding?',
                buttons: [
                    { label: 'YES', value: 'yes' },
                    { label: 'NO', value: 'no', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' },
                ],
            },
        }).closed);
        if (result === 'no') return true;
        if (result !== 'yes') return false;
        try {
            if (!await this.forcePersistence.saveForceAndWaitForCloud(force)) {
                throw new Error('The force ceased to be authoritative before persistence completed.');
            }
            return true;
        } catch (error) {
            this.logger.error(`Error saving force: ${error}`);
            this.toast.showToast('The force could not be saved. It was not removed.', 'error');
            return false;
        }
    }

    async promptSaveAll(forces: readonly Force[]): Promise<boolean> {
        for (const force of forces) {
            if (!await this.promptSaveForceIfNeeded(force)) return false;
        }
        return true;
    }

    async openC3Network(force: Force, readOnly = false): Promise<void> {
        const workspace = this.workspace;
        const expectedSlot = workspace.getForceSlot(force);
        if (!expectedSlot || expectedSlot.force !== force || !force.isWholeOwnerActive()) return;
        const expectedUnits = force instanceof CBTForce ? null : [...force.units()];
        const ownerRevisionFence = force.captureForceOwnerRevisionFence();
        const { C3NetworkDialogComponent } = await import('../components/c3-network-dialog/c3-network-dialog.component');
        type C3NetworkDialogData = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogData;
        type C3NetworkDialogResult = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogResult;
        if (workspace.getForceSlot(force) !== expectedSlot
            || !force.isWholeOwnerActive()
            || !force.isForceOwnerRevisionFenceCurrent(ownerRevisionFence)
            || (expectedUnits !== null
                && (force.units().length !== expectedUnits.length
                    || force.units().some((unit, index) => unit !== expectedUnits[index])))) return;

        const result = await firstValueFrom(this.dialogs.createDialog<C3NetworkDialogResult>(C3NetworkDialogComponent, {
            data: <C3NetworkDialogData>{ force, readOnly },
            panelClass: 'c3-network-dialog-panel',
        }).closed);
        if (!result?.updated) return;

        let changed = false;
        if (force instanceof CBTForce && result.authority === 'cbt') {
            changed = workspace.getForceSlot(force) === expectedSlot
                && force.replaceC3EncounterConfigurationIfOwnerRevisionCurrent(
                    ownerRevisionFence,
                    result.networks,
                    result.positions,
                );
        } else if (!(force instanceof CBTForce) && result.authority === 'alpha-strike') {
            changed = workspace.getForceSlot(force) === expectedSlot
                && expectedUnits !== null
                && force.units().length === expectedUnits.length
                && force.units().every((unit, index) => unit === expectedUnits[index])
                && force.setC3ConfigurationIfOwnerRevisionCurrent(
                    ownerRevisionFence,
                    result.networks,
                    result.positions,
                );
        }
        if (changed) this.toast.showToast('C3 network configuration changed', 'success');
    }

    private applyRenameForceDialogResult(force: Force, result: RenameForceDialogResult): void {
        if (result.action === 'unset') {
            force.factionLock = false;
            force.faction.set(null);
            force.eraLock = false;
            force.era.set(null);
            force.setName('');
            this.formations.generateFactionAndForceNameIfNeeded(force);
            return;
        }
        force.factionLock = true;
        force.faction.set(result.faction);
        force.eraLock = result.era !== null;
        force.era.set(result.era);
        force.setName(result.name);
    }

}
