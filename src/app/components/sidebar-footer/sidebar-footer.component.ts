
import { ChangeDetectionStrategy, Component, DestroyRef, inject, computed, input, ElementRef, viewChildren } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { OptionsDialogComponent } from '../options-dialog/options-dialog.component';
import { ToastService } from '../../services/toast.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceAlignment } from '../../models/force-slot.model';
import { CdkMenuModule, CdkMenuTrigger, MenuTracker } from '@angular/cdk/menu';
import { CompactModeService } from '../../services/compact-mode.service';
import { C3NetworkUtil } from '../../utils/c3-network.util';

/*
 * Sidebar footer component
 *
 */
@Component({
    selector: 'sidebar-footer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkMenuModule],
    templateUrl: './sidebar-footer.component.html',
    styleUrls: ['./sidebar-footer.component.scss'],
})
export class SidebarFooterComponent {
    elRef = inject(ElementRef<HTMLElement>);
    layoutService = inject(LayoutService);
    toastService = inject(ToastService);
    forceBuilderService = inject(ForceBuilderService);
    dialogsService = inject(DialogsService);
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

    constructor() {
        inject(DestroyRef).onDestroy(() => this.closeAllMenus());
    }
    
    toggleCompactMode() {
        this.compactModeService.toggle();
    }

    cycleAlignmentFilter() {
        this.forceBuilderService.cycleAlignmentFilter();
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

    showLoadForceDialog(): void {
        this.forceBuilderService.showLoadForceDialog();
    }

    showForcePackDialog(): void {
        this.forceBuilderService.showForcePackDialog();
    }

    async addExternalForce(alignment: ForceAlignment): Promise<void> {
        const instanceId = await this.dialogsService.prompt(
            'Enter the Force Instance ID or a MekBay URL:',
            alignment === 'friendly' ? 'Add Friendly Force' : 'Add Opposing Force',
            '',
            'You can paste an Instance ID or a full MekBay URL containing one.'
        );
        if (!instanceId) return;
        await this.forceBuilderService.addForceById(instanceId.trim(), alignment);
    }

    async requestRemoveAllForces(): Promise<void> {
        if (await this.forceBuilderService.removeAllForces()) {
            this.layoutService.closeMenu();
        }
    }

    async saveForce(): Promise<void> {
        const force = this.forceBuilderService.smartCurrentForce();
        if (!force || force.readOnly()) {return; }
        await this.forceBuilderService.saveForceWithNameConfirmation(force);
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