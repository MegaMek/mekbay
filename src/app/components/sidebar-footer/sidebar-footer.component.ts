// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, DestroyRef, inject, computed, input, signal, effect, ElementRef, viewChildren } from '@angular/core';
import { type Subscription, firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { OptionsDialogComponent } from '../options-dialog/options-dialog.component';
import { ToastService } from '../../services/toast.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceDialogsService } from '../../services/force-dialogs.service';
import { ForceRemoteSyncService } from '../../services/force-remote-sync.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { ForceImportService } from '../../services/force-import.service';
import { DialogsService } from '../../services/dialogs.service';
import { DataService } from '../../services/data.service';
import { ForcePersistenceService } from '../../services/force-persistence.service';
import { OrganizationStorageService } from '../../services/organization-storage.service';
import type { ForceAlignment } from '../../models/force-slot.model';
import { CdkMenuModule, CdkMenuTrigger } from '@angular/cdk/menu';
import { CompactModeService } from '../../services/compact-mode.service';
import { C3Capabilities } from '../../models/c3-network.model';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import type { ForceSlot } from '../../models/force-slot.model';
import type { LoadOrganizationEntry } from '../../models/organization.model';
import { AlignmentPickerDialogComponent, type AlignmentPickerResult } from '../alignment-picker-dialog/alignment-picker-dialog.component';
import { AddExternalForceDialogComponent } from '../add-external-force-dialog/add-external-force-dialog.component';
import { getFactionImg } from '../../models/factions.model';
import { GameSystem } from '../../models/common.model';
import { AppUpdateService } from '../../services/app-update.service';
import { ForceOperationService } from '../../services/force-operation.service';
import { closeCdkMenus } from '../../utils/cdk-menu.util';
import { LobbyService } from '../../services/lobby.service';
import { isCBTForceMember, isCBTMekForceMember } from '../../models/force-member.model';
import { hasMekRuntime } from '../../models/cbt-unit-snapshot';

/*
 * Sidebar footer component
 *
 */
@Component({
    selector: 'sidebar-footer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkMenuModule, FactionImgPipe],
    templateUrl: './sidebar-footer.component.html',
    styleUrl: './sidebar-footer.component.scss',
})
export class SidebarFooterComponent {
    elRef = inject(ElementRef<HTMLElement>);
    layoutService = inject(LayoutService);
    toastService = inject(ToastService);
    forceBuilderService = inject(ForceBuilderService);
    protected readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly forceDialogs = inject(ForceDialogsService);
    private readonly remoteSync = inject(ForceRemoteSyncService);

    private readonly forceCommands = inject(ForceWorkspaceCommandsService);
    forceImportService = inject(ForceImportService);
    operationService = inject(ForceOperationService);
    dialogsService = inject(DialogsService);
    dataService = inject(DataService);
    private readonly forcePersistence = inject(ForcePersistenceService);
    private readonly organizationStorage = inject(OrganizationStorageService);
    appUpdateService = inject(AppUpdateService);
    lobbyService = inject(LobbyService);
    compactModeService = inject(CompactModeService);
    menuTriggers = viewChildren<CdkMenuTrigger>(CdkMenuTrigger);

    compactMode = computed(() => {
        return this.compactModeService.compactMode();
    });
    singleButton = input<boolean>(false);

    /**
     * Returns true if the force can be saved (has units, no instanceId, and is not readOnly)
     */
    smartCurrentForceCanSave = computed<boolean>(() => {
        const f = this.forceWorkspace.smartCurrentForce();
        return !!f && f.members().length > 0 && !f.instanceId() && !f.readOnly();
    });

    /** Friendly slots in the loaded operation. */
    operationFriendlySlots = computed<ForceSlot[]>(() =>
        this.forceWorkspace.loadedForces().filter(s => s.alignment === 'friendly')
    );

    /** Enemy slots in the loaded operation. */
    operationEnemySlots = computed<ForceSlot[]>(() =>
        this.forceWorkspace.loadedForces().filter(s => s.alignment === 'enemy')
    );

    /**
     * Returns true if the force has any units with C3 network capability
     */
    hasC3Units = computed(() => {
        const force = this.forceWorkspace.currentForce();
        return force ? force.members().some(member => {
            if (!isCBTForceMember(member)) return new C3Capabilities(member).hasC3;
            if (!isCBTMekForceMember(member)) return false;
            const snapshot = member.force.getUnitSnapshot(member.id);
            const capability = snapshot && hasMekRuntime(snapshot)
                ? snapshot.query.mekC3Endpoints()
                : null;
            return capability?.kind === 'supported' && capability.endpoints.length > 0;
        }) : false;
    });

    /**
     * Title text for the alignment filter button based on current state.
     */
    alignmentFilterTitle = computed(() => {
        switch (this.forceWorkspace.alignmentFilter()) {
            case 'friendly': return 'Click to show Enemy';
            default: return 'Click to show Friendly';
        }
    });

    /** True when the alignment filter button should blink (remote update on hidden alignment). */
    alignmentFilterBlink = signal(false);
    private blinkTimeout: ReturnType<typeof setTimeout> | null = null;
    private remoteUpdateSub: Subscription | null = null;

    optimizeBudgetLabel = computed(() => (
        this.forceWorkspace.smartCurrentForce()?.gameSystem === GameSystem.AS ? 'Optimize PV...' : 'Optimize BV...'
    ));

    canOpenForceGeneratorWithCurrentForce = computed(() => {
        const force = this.forceWorkspace.smartCurrentForce();
        return !!force && force.members().length > 0;
    });

    canOptimizeBudget = computed(() => {
        const force = this.forceWorkspace.smartCurrentForce();
        return !!force && force.members().length > 0 && !force.readOnly();
    });

    constructor() {
        const destroyRef = inject(DestroyRef);

        this.remoteUpdateSub = this.remoteSync.remoteForceUpdated$.subscribe(({ alignment }) => {
            if (!this.forceWorkspace.hasMixedAlignments()) return;
            const filter = this.forceWorkspace.alignmentFilter();
            // Blink when the updated force is NOT visible (filter doesn't match)
            const isHidden = filter !== 'all' && filter !== alignment;
            if (isHidden) {
                if (this.blinkTimeout) clearTimeout(this.blinkTimeout);
                this.alignmentFilterBlink.set(true);
                this.blinkTimeout = setTimeout(() => this.alignmentFilterBlink.set(false), 2000);
            }
        });

        destroyRef.onDestroy(() => {
            this.closeAllMenus();
            this.remoteUpdateSub?.unsubscribe();
            if (this.blinkTimeout) clearTimeout(this.blinkTimeout);
        });

        // Refresh org membership when the current force changes
        effect(() => {
            const force = this.forceWorkspace.currentForce();
            const instanceId = force?.instanceId();
            if (instanceId) {
                this.refreshForceOrganizations();
            } else {
                this.forceOrgEntries = [];
                this.forceHasOrganizations.set(false);
            }
        });
    }
    
    toggleCompactMode() {
        this.compactModeService.toggle();
    }

    cycleAlignmentFilter() {
        this.forceWorkspace.cycleAlignmentFilter();
    }

    selectOperationForce(slot: ForceSlot): void {
        const firstUnit = slot.force.members()[0] ?? null;
        this.forceWorkspace.selectUnit(firstUnit);
        const filter = this.forceWorkspace.alignmentFilter();
        if (filter !== 'all' && filter !== slot.alignment) {
            this.forceWorkspace.alignmentFilter.set(slot.alignment);
        }
    }

    showOptionsDialog(): void {
        this.dialogsService.createDialog(OptionsDialogComponent);
    }

    async showBudgetOptimizerDialog(): Promise<void> {
        const force = this.forceWorkspace.smartCurrentForce();
        if (!force || force.readOnly() || force.members().length === 0) { return; }
        const { ForceBudgetOptimizerDialogComponent } = await import('../force-budget-optimizer-dialog/force-budget-optimizer-dialog.component');
        this.dialogsService.createDialog(ForceBudgetOptimizerDialogComponent, {
            data: { force },
        });
    }

    async showCurrentForceInGeneratorDialog(): Promise<void> {
        const force = this.forceWorkspace.smartCurrentForce();
        if (!force || force.members().length === 0) { return; }
        await this.forceImportService.showSearchForceGeneratorDialog({ importCurrentForce: true });
    }

    showForceOverview(): void {
        const force = this.forceWorkspace.currentForce();
        if (!force) { return; }
        void this.forceDialogs.showForceOverview(force);
    }

    showC3NetworkDialog(): void {
        const force = this.forceWorkspace.currentForce();
        if (!force) { return; }
        this.forceDialogs.showC3Network(force);
    }

    /** Cached org entries for the current force. */
    private forceOrgEntries: LoadOrganizationEntry[] = [];
    /** Whether the current force belongs to at least one saved organization. */
    forceHasOrganizations = signal(false);

    async refreshForceOrganizations(): Promise<void> {
        const force = this.forceWorkspace.currentForce();
        const instanceId = force?.instanceId();
        if (!instanceId) {
            this.forceOrgEntries = [];
            this.forceHasOrganizations.set(false);
            return;
        }
        this.forceOrgEntries = await this.organizationStorage.findOrganizationsForForce(instanceId);
        this.forceHasOrganizations.set(this.forceOrgEntries.length > 0);
    }

    async showForceOrgDialog(): Promise<void> {
        const force = this.forceWorkspace.currentForce();
        const instanceId = force?.instanceId();
        if (!instanceId) return;

        // Refresh in case orgs changed
        await this.refreshForceOrganizations();
        const orgs = this.forceOrgEntries;

        if (orgs.length === 0) return;

        if (orgs.length === 1) {
            const ref = await this.forceDialogs.showForceOrgDialog(orgs[0].organizationId);
            await firstValueFrom(ref.closed);
            await this.refreshForceOrganizations();
            return;
        }

        // Multiple orgs — show selection dialog
        const factionImages = new Map<string, string | undefined>();
        for (const org of orgs) {
            if (org.factionId != null) {
                const faction = this.dataService.getFactionById(org.factionId);
                factionImages.set(org.organizationId, faction ? getFactionImg(faction) : undefined);
            }
        }

        const { OrgSelectDialogComponent } = await import('../org-select-dialog/org-select-dialog.component');
        const ref = this.dialogsService.createDialog<LoadOrganizationEntry | null>(OrgSelectDialogComponent, {
            data: { organizations: orgs, factionImages },
        });
        const selected = await firstValueFrom(ref.closed);
        if (selected) {
            const orgRef = await this.forceDialogs.showForceOrgDialog(selected.organizationId);
            await firstValueFrom(orgRef.closed);
            await this.refreshForceOrganizations();
        }
    }

    showLoadForceDialog(): void {
        void this.forceImportService.showLoadForceDialog();
    }

    showForcePackDialog(): void {
        void this.forceImportService.showForcePackDialog();
    }

    async addExternalForce(): Promise<void> {
        const inputDialogRef = this.dialogsService.createDialog<string | null>(AddExternalForceDialogComponent, {
            disableClose: true,
        });
        const input = await firstValueFrom(inputDialogRef.closed);
        if (!input?.trim()) return;

        const instanceId = this.extractInstanceId(input.trim());

        // Check if already loaded
        if (this.forceWorkspace.loadedForces().some(s => s.force.instanceId() === instanceId)) {
            this.toastService.showToast('This force is already loaded.', 'info');
            return;
        }

        const force = await this.forcePersistence.getForce(instanceId);
        if (!force) {
            this.toastService.showToast('Force not found.', 'error');
            return;
        }

        // Show alignment picker with force preview
        const alignmentDialogRef = this.dialogsService.createDialog<AlignmentPickerResult | null>(AlignmentPickerDialogComponent, {
            data: { force }
        });
        const result = await firstValueFrom(alignmentDialogRef.closed);
        if (!result) return;

        let forceToAdd = force;
        if (result.clone) {
            forceToAdd = await force.cloneForPersistence();
            forceToAdd.loading = true;
            try {
                await this.forcePersistence.saveForce(forceToAdd);
            } finally {
                forceToAdd.loading = false;
            }
        }

        if (!this.forceBuilderService.addLoadedForce(forceToAdd, result.alignment)) {
            this.toastService.showToast('This force is already loaded or no longer active.', 'info');
            return;
        }
        this.toastService.showToast(`Force "${forceToAdd.name}" added.`, 'success');
    }

    private extractInstanceId(input: string): string {
        try {
            const url = new URL(input);
            const instance = url.searchParams.get('instance');
            if (instance) return instance;
        } catch {
            // Not a valid URL: treat as a plain instance ID
        }
        return input;
    }

    async requestClear(): Promise<void> {
        if (await this.forceBuilderService.clear()) {
            this.layoutService.closeMenu();
        }
    }

    async saveForce(): Promise<void> {
        const force = this.forceWorkspace.smartCurrentForce();
        if (!force || force.readOnly()) {return; }
        await this.forceDialogs.saveForceWithNameConfirmation(force);
    }

    async saveOperation(): Promise<void> {
        await this.operationService.saveOperation();
    }

    async updateOperation(): Promise<void> {
        await this.operationService.updateOperation();
    }

    async closeOperation(): Promise<void> {
        await this.operationService.closeOperation();
    }

    loadOperation(): void {
        void this.forceImportService.showLoadForceDialog({ initialTab: 'Operations' });
    }

    async createLobby(): Promise<void> {
        try {
            await this.lobbyService.createLobby();
            await this.lobbyService.showLobbyDialog();
        } catch (error) {
            this.toastService.showToast(error instanceof Error ? error.message : 'Could not create the lobby.', 'error');
        }
    }

    async joinLobby(): Promise<void> {
        await this.lobbyService.promptAndJoin();
    }

    async showLobbyDialog(): Promise<void> {
        await this.lobbyService.showLobbyDialog();
    }

    async requestRepairAll(): Promise<void> {
        const force = this.forceWorkspace.smartCurrentForce();
        if (!force || force.readOnly()) {return; }
        if (await this.forceCommands.repairAllUnits(force)) {
            this.toastService.showToast(`Repaired all units.`, 'success');
        }
    }

    async requestCloneForce(): Promise<void> {
        const force = this.forceWorkspace.currentForce();
        if (!force) { return; }
        this.forceCommands.requestCloneForce(force);
    }

    toggleFollowLastModified() {
        this.forceWorkspace.followLastModifiedUnit.update(v => !v);
    }

    shareForce() {
        this.forceDialogs.shareForce(this.forceWorkspace.currentForce());
    }

    printAll(): void {
        void this.forceDialogs.printAll(this.forceWorkspace.currentForce());
    }

    closeAllMenus(): void {
        closeCdkMenus(this.menuTriggers());
    }
}
