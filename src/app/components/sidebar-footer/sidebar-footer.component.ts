
import { ChangeDetectionStrategy, Component, inject, computed, input, ElementRef, Renderer2, Injector, viewChildren } from '@angular/core';
import { PortalModule } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { ForceUnit } from '../../models/force-unit.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { ForceLoadDialogComponent } from '../force-load-dialog/force-load-dialog.component';
import { OptionsDialogComponent } from '../options-dialog/options-dialog.component';
import { ToastService } from '../../services/toast.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { DialogsService } from '../../services/dialogs.service';
import { DataService } from '../../services/data.service';
import { ForcePackDialogComponent } from '../force-pack-dialog/force-pack-dialog.component';
import { CBTPrintUtil } from '../../utils/cbtprint.util';
import { CdkMenuModule, CdkMenuTrigger } from '@angular/cdk/menu';
import { ShareForceDialogComponent, ShareForceDialogData } from '../share-force-dialog/share-force-dialog.component';
import { CompactModeService } from '../../services/compact-mode.service';
import { CBTForce } from '../../models/cbt-force.model';

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
    elRef = inject(ElementRef<HTMLElement>);
    layoutService = inject(LayoutService);
    optionsService = inject(OptionsService);
    toastService = inject(ToastService);
    forceBuilderService = inject(ForceBuilderService);
    dialogsService = inject(DialogsService);
    dataService = inject(DataService);
    renderer = inject(Renderer2);
    compactModeService = inject(CompactModeService);
    menuTriggers = viewChildren<CdkMenuTrigger>(CdkMenuTrigger);

    compactMode = computed(() => {
        return this.compactModeService.compactMode();
    });
    singleButton = input<boolean>(false);

    constructor() {}
    
    toggleCompactMode() {
        this.compactModeService.toggle();
    }

    showOptionsDialog(): void {
        this.dialogsService.createDialog(OptionsDialogComponent);
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

    async requestRepairAll(): Promise<void> {
        if (await this.forceBuilderService.repairAllUnits()) {
            this.toastService.show(`Repaired all units.`, 'success');
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
            CBTPrintUtil.multipagePrint(this.dataService, this.optionsService, currentForce.units());
        }
    }

    closeAllMenus(): void {
        const menuTriggers = this.menuTriggers();
        if (!menuTriggers) { return; }
        menuTriggers.forEach(t => {
            try {
                (t as any).closeMenu?.() ?? (t as any).close?.();
            } catch(ignored) {}
        });
    }
}