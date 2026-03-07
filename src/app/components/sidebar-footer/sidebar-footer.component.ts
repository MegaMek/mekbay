
import { ChangeDetectionStrategy, Component, DestroyRef, inject, computed, input, signal, effect, ElementRef, viewChildren } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { OptionsDialogComponent } from '../options-dialog/options-dialog.component';
import { ToastService } from '../../services/toast.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { DialogsService } from '../../services/dialogs.service';
import { DataService } from '../../services/data.service';
import { ForceAlignment } from '../../models/force-slot.model';
import { CdkMenuModule, CdkMenuTrigger, MenuTracker } from '@angular/cdk/menu';
import { CompactModeService } from '../../services/compact-mode.service';
import { C3NetworkUtil } from '../../utils/c3-network.util';
import { CommonModule } from '@angular/common';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { ForceSlot } from '../../models/force-slot.model';
import { LoadOrganizationEntry } from '../../models/organization.model';

/*
 * Sidebar footer component
 *
 */
@Component({
    selector: 'sidebar-footer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkMenuModule, CommonModule, FactionImgPipe],
    templateUrl: './sidebar-footer.component.html',
    styleUrls: ['./sidebar-footer.component.scss'],
})
export class SidebarFooterComponent {
    elRef = inject(ElementRef<HTMLElement>);
    layoutService = inject(LayoutService);
    toastService = inject(ToastService);
    forceBuilderService = inject(ForceBuilderService);
    dialogsService = inject(DialogsService);
    dataService = inject(DataService);
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
        const f = this.forceBuilderService.smartCurrentForce();
        return !!f && f.units().length > 0 && !f.instanceId() && !f.readOnly();
    });

    /** Friendly slots in the loaded operation. */
    operationFriendlySlots = computed<ForceSlot[]>(() =>
        this.forceBuilderService.loadedForces().filter(s => s.alignment === 'friendly')
    );

    /** Enemy slots in the loaded operation. */
    operationEnemySlots = computed<ForceSlot[]>(() =>
        this.forceBuilderService.loadedForces().filter(s => s.alignment === 'enemy')
    );

    /**
     * Returns true if the force has any units with C3 network capability
     */
    hasC3Units = computed(() => {
        return this.forceBuilderService.currentForce()?.units()?.some(forceUnit => {
            const unit = forceUnit.getUnit();
            return C3NetworkUtil.getC3Components(unit).length > 0;
        });
    });

    /**
     * Title text for the alignment filter button based on current state.
     */
    alignmentFilterTitle = computed(() => {
        switch (this.forceBuilderService.alignmentFilter()) {
            case 'friendly': return 'Click to show Enemy';
            default: return 'Click to show Friendly';
        }
    });

    /** True when the alignment filter button should blink (remote update on hidden alignment). */
    alignmentFilterBlink = signal(false);
    private blinkTimeout: ReturnType<typeof setTimeout> | null = null;
    private remoteUpdateSub: Subscription | null = null;

    constructor() {
        const destroyRef = inject(DestroyRef);

        this.remoteUpdateSub = this.forceBuilderService.remoteForceUpdated$.subscribe(({ alignment }) => {
            if (!this.forceBuilderService.hasMixedAlignments()) return;
            const filter = this.forceBuilderService.alignmentFilter();
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
            const force = this.forceBuilderService.currentForce();
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
        this.forceBuilderService.cycleAlignmentFilter();
    }

    selectOperationForce(slot: ForceSlot): void {
        const firstUnit = slot.force.units()[0] ?? null;
        this.forceBuilderService.selectUnit(firstUnit);
        const filter = this.forceBuilderService.alignmentFilter();
        if (filter !== 'all' && filter !== slot.alignment) {
            this.forceBuilderService.alignmentFilter.set(slot.alignment);
        }
    }

    showOptionsDialog(): void {
        this.dialogsService.createDialog(OptionsDialogComponent);
    }

    showForceOverview(): void {
        const force = this.forceBuilderService.currentForce();
        if (!force) { return; }
        this.forceBuilderService.showForceOverview(force);
    }

    showC3NetworkDialog(): void {
        const force = this.forceBuilderService.currentForce();
        if (!force) { return; }
        this.forceBuilderService.showC3Network(force);
    }

    /** Cached org entries for the current force. */
    private forceOrgEntries: LoadOrganizationEntry[] = [];
    /** Whether the current force belongs to at least one saved organization. */
    forceHasOrganizations = signal(false);

    async refreshForceOrganizations(): Promise<void> {
        const force = this.forceBuilderService.currentForce();
        const instanceId = force?.instanceId();
        if (!instanceId) {
            this.forceOrgEntries = [];
            this.forceHasOrganizations.set(false);
            return;
        }
        this.forceOrgEntries = await this.dataService.findOrganizationsForForce(instanceId);
        this.forceHasOrganizations.set(this.forceOrgEntries.length > 0);
    }

    async showForceOrgDialog(): Promise<void> {
        const force = this.forceBuilderService.currentForce();
        const instanceId = force?.instanceId();
        if (!instanceId) return;

        // Refresh in case orgs changed
        await this.refreshForceOrganizations();
        const orgs = this.forceOrgEntries;

        if (orgs.length === 0) return;

        if (orgs.length === 1) {
            const ref = await this.forceBuilderService.showForceOrgDialog(orgs[0].organizationId, instanceId);
            await firstValueFrom(ref.closed);
            await this.refreshForceOrganizations();
            return;
        }

        // Multiple orgs — show selection dialog
        const factionImages = new Map<string, string | undefined>();
        for (const org of orgs) {
            if (org.factionId != null) {
                const faction = this.dataService.getFactionById(org.factionId);
                factionImages.set(org.organizationId, faction?.img || undefined);
            }
        }

        const { OrgSelectDialogComponent } = await import('../org-select-dialog/org-select-dialog.component');
        const ref = this.dialogsService.createDialog<LoadOrganizationEntry | null>(OrgSelectDialogComponent, {
            data: { organizations: orgs, factionImages },
        });
        const selected = await firstValueFrom(ref.closed);
        if (selected) {
            const orgRef = await this.forceBuilderService.showForceOrgDialog(selected.organizationId, instanceId);
            await firstValueFrom(orgRef.closed);
            await this.refreshForceOrganizations();
        }
    }

    showLoadForceDialog(): void {
        this.forceBuilderService.showLoadForceDialog();
    }

    showForcePackDialog(): void {
        this.forceBuilderService.showForcePackDialog();
    }

    async addExternalForce(): Promise<void> {
        const input = await this.dialogsService.prompt(
            'Enter the Force Instance ID or a MekBay URL:',
            'Add Force',
            '',
            'You can paste an Instance ID or a full MekBay URL containing one. To directly add one of your own forces, use the ADD button in the Load dialog instead.'
        );
        if (!input) return;

        const instanceId = this.extractInstanceId(input.trim());

        // Check if already loaded
        if (this.forceBuilderService.loadedForces().some(s => s.force.instanceId() === instanceId)) {
            this.toastService.showToast('This force is already loaded.', 'info');
            return;
        }

        const force = await this.dataService.getForce(instanceId);
        if (!force) {
            this.toastService.showToast('Force not found.', 'error');
            return;
        }

        // Show alignment picker with force preview
        const { AlignmentPickerDialogComponent } = await import('../alignment-picker-dialog/alignment-picker-dialog.component');
        type AlignmentPickerResult = import('../alignment-picker-dialog/alignment-picker-dialog.component').AlignmentPickerResult;
        const ref = this.dialogsService.createDialog<AlignmentPickerResult | null>(AlignmentPickerDialogComponent, {
            data: { force }
        });
        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        let forceToAdd = force;
        if (result.clone) {
            forceToAdd = force.clone();
            forceToAdd.loading = true;
            try {
                await this.dataService.saveForce(forceToAdd);
            } finally {
                forceToAdd.loading = false;
            }
        }

        this.forceBuilderService.addLoadedForce(forceToAdd, result.alignment);
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
        const force = this.forceBuilderService.smartCurrentForce();
        if (!force || force.readOnly()) {return; }
        await this.forceBuilderService.saveForceWithNameConfirmation(force);
    }

    async saveOperation(): Promise<void> {
        await this.forceBuilderService.saveOperation();
    }

    async updateOperation(): Promise<void> {
        await this.forceBuilderService.updateOperation();
    }

    async closeOperation(): Promise<void> {
        await this.forceBuilderService.closeOperation();
    }

    loadOperation(): void {
        this.forceBuilderService.showLoadForceDialog({ initialTab: 'Operations' });
    }

    async requestRepairAll(): Promise<void> {
        const force = this.forceBuilderService.smartCurrentForce();
        if (!force || force.readOnly()) {return; }
        if (await this.forceBuilderService.repairAllUnits(force)) {
            this.toastService.showToast(`Repaired all units.`, 'success');
        }
    }

    async requestCloneForce(): Promise<void> {
        const force = this.forceBuilderService.currentForce();
        if (!force) { return; }
        this.forceBuilderService.requestCloneForce(force);
    }

    toggleFollowLastModified() {
        this.forceBuilderService.followLastModifiedUnit.update(v => !v);
    }

    shareForce() {
        this.forceBuilderService.shareForce();
    }

    printAll(): void {
        this.forceBuilderService.printAll();
    }

    closeAllMenus(): void {
        const menuTriggers = this.menuTriggers();
        if (!menuTriggers) { return; }
        menuTriggers.forEach(t => {
            try {
                if (t.isOpen()) {
                    t.close();
                }
                // Workaround for CDK bug: MenuTracker never clears _openMenuTrigger,
                // causing memory leaks when menu triggers are destroyed.
                this.clearMenuTrackerReference(t);
            } catch(ignored) {}
        });
    }

    /**
     * CDK's MenuTracker holds a static reference to the last opened trigger forever.
     * This causes memory leaks when components with menu triggers are destroyed.
     * This is a workaround until CDK provides a proper cleanup API.
     * Thank you Angular team for not making this public API.
     */
    private clearMenuTrackerReference(trigger: CdkMenuTrigger): void {
        const tracker = MenuTracker as unknown as { _openMenuTrigger?: CdkMenuTrigger };
        if (tracker._openMenuTrigger === trigger) {
            tracker._openMenuTrigger = undefined;
        }
    }
}