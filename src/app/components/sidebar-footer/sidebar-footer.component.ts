
import { ChangeDetectionStrategy, Component, DestroyRef, inject, computed, input, ElementRef, Injector, viewChildren, ApplicationRef } from '@angular/core';
import { PortalModule } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { OptionsDialogComponent } from '../options-dialog/options-dialog.component';
import { ToastService } from '../../services/toast.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { DialogsService } from '../../services/dialogs.service';
import { SheetService } from '../../services/sheet.service';
import { CBTPrintUtil } from '../../utils/cbtprint.util';
import { ASPrintUtil } from '../../utils/asprint.util';
import { CdkMenuModule, CdkMenuTrigger, MenuTracker } from '@angular/cdk/menu';
import { ShareForceDialogComponent } from '../share-force-dialog/share-force-dialog.component';
import { CompactModeService } from '../../services/compact-mode.service';
import { CBTForce } from '../../models/cbt-force.model';
import { ASForce } from '../../models/as-force.model';
import { ForceOverviewDialogComponent } from '../force-overview-dialog/force-overview-dialog.component';
import { C3NetworkUtil } from '../../utils/c3-network.util';

/*
 * Sidebar footer component
 *
 */
@Component({
    selector: 'sidebar-footer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [PortalModule, CdkMenuModule],
    templateUrl: './sidebar-footer.component.html',
    styleUrls: ['./sidebar-footer.component.scss'],
})
export class SidebarFooterComponent {
    injector = inject(Injector);
    appRef = inject(ApplicationRef);
    elRef = inject(ElementRef<HTMLElement>);
    layoutService = inject(LayoutService);
    optionsService = inject(OptionsService);
    toastService = inject(ToastService);
    forceBuilderService = inject(ForceBuilderService);
    dialogsService = inject(DialogsService);
    sheetService = inject(SheetService);
    compactModeService = inject(CompactModeService);
    menuTriggers = viewChildren<CdkMenuTrigger>(CdkMenuTrigger);

    compactMode = computed(() => {
        return this.compactModeService.compactMode();
    });
    singleButton = input<boolean>(false);

    /**
     * Returns true if the force can be saved (has units, no instanceId, and is not readOnly)
     */
    canSaveForce = computed(() => {
        const force = this.forceBuilderService.currentForce();
        if (!force) return false;
        return force.units().length > 0 && !force.instanceId() && !force.readOnly();
    });

    /**
     * Returns true if the force has any units (for showing Overview menu item)
     */
    hasUnits = computed(() => {
        const force = this.forceBuilderService.currentForce();
        if (!force) return false;
        return force.units().length > 0;
    });

    /**
     * Returns true if the force has any units with C3 network capability
     */
    hasC3Units = computed(() => {
        const force = this.forceBuilderService.currentForce();
        if (!force) return false;
        const units = force.units();
        if (units.length === 0) return false;
        return units.some(forceUnit => {
            const unit = forceUnit.getUnit();
            return C3NetworkUtil.getC3Components(unit).length > 0;
        });
    });

    constructor() {
        inject(DestroyRef).onDestroy(() => this.closeAllMenus());
    }
    
    toggleCompactMode() {
        this.compactModeService.toggle();
    }

    showOptionsDialog(): void {
        this.dialogsService.createDialog(OptionsDialogComponent);
    }

    showForceOverview(): void {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce) return;
        this.dialogsService.createDialog(ForceOverviewDialogComponent, {
            data: { force: currentForce }
        });
    }

    showC3NetworkDialog(): void {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce) return;
        const readOnly = this.forceBuilderService.readOnlyForce();
        this.forceBuilderService.openC3Network(currentForce, readOnly);
    }

    showLoadForceDialog(): void {
        this.forceBuilderService.showLoadForceDialog();
    }

    showForcePackDialog(): void {
        this.forceBuilderService.showForcePackDialog();
    }

    async requestRemoveForce(): Promise<void> {
        if (await this.forceBuilderService.removeForce()) {
            this.layoutService.closeMenu();
        }
    }

    async saveForce(): Promise<void> {
        await this.forceBuilderService.saveForceWithNameConfirmation();
    }

    async requestRepairAll(): Promise<void> {
        if (await this.forceBuilderService.repairAllUnits()) {
            this.toastService.showToast(`Repaired all units.`, 'success');
        }
    }

    async requestCloneForce(): Promise<void> {
        this.forceBuilderService.requestCloneForce();
    }

    shareForce() {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce) return;
        this.dialogsService.createDialog(ShareForceDialogComponent, {
            data: { force: currentForce }
        });
    }

    printAll(): void {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce) {
            return;
        }
        if (currentForce instanceof CBTForce) {
            CBTPrintUtil.multipagePrint(this.sheetService, this.optionsService, currentForce.units());
        } else if (currentForce instanceof ASForce) {
            ASPrintUtil.multipagePrint(this.appRef, this.injector, this.optionsService, currentForce.groups());
        }
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