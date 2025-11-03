import { CommonModule } from '@angular/common';
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
import { Dialog } from '@angular/cdk/dialog';
import { DataService } from '../../services/data.service';
import { ForcePackDialogComponent } from '../force-pack-dialog/force-pack-dialog.component';
import { PrintUtil } from '../../utils/print.util';
import { CdkMenuModule, CdkMenuTrigger } from '@angular/cdk/menu';
import { ShareForceDialogComponent } from '../share-force-dialog/share-force-dialog.component';
import { CompactModeService } from '../../services/compact-mode.service';

/*
 * Sidebar footer component
 *
 */
@Component({
    selector: 'sidebar-footer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, PortalModule, CdkMenuModule],
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
    dialog = inject(Dialog);
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

    showOptionsMenu(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        this.forceBuilderService.selectUnit(unit);
    }

    
    showOptionsDialog(): void {
        this.dialog.open(OptionsDialogComponent);
    }

    showLoadForceDialog(): void {
        const ref = this.dialog.open(ForceLoadDialogComponent);
        ref.componentInstance?.load.subscribe(async (force) => {
            if (force instanceof LoadForceEntry) {
                const requestedForce = await this.dataService.getForce(force.instanceId);
                if (!requestedForce) {
                    this.toastService.show('Failed to load force.', 'error');
                    return;
                }
                this.forceBuilderService.loadForce(requestedForce);
            } else {
                if (force && force.units && force.units.length > 0) {
                    await this.forceBuilderService.createNewForce();
                    const group = this.forceBuilderService.addGroup();
                    for (const unit of force.units) {
                        if (!unit?.unit) continue;
                        this.forceBuilderService.addUnit(unit.unit, undefined, undefined, group);
                    }
                }
            }
            ref.close();
        });
    }

    showForcePackDialog(): void {
        const ref = this.dialog.open(ForcePackDialogComponent);
        ref.componentInstance?.add.subscribe(async (pack) => {
            if (pack) {
                const group = this.forceBuilderService.addGroup();
                for (const unit of pack.units) {
                    if (!unit?.unit) continue;
                    this.forceBuilderService.addUnit(unit.unit, undefined, undefined, group);
                }
            }
            ref.close();
        });
    }

    async requestNewForce(): Promise<void> {
        if (await this.forceBuilderService.createNewForce()) {
            this.layoutService.closeMenu();
        }
    }

    async requestRepairAll(): Promise<void> {
        if (await this.forceBuilderService.repairAllUnits()) {
            this.toastService.show(`Repaired all units.`, 'info');
        }
    }

    async requestCloneForce(): Promise<void> {
        this.forceBuilderService.requestCloneForce();
    }

    shareForce() {
        this.dialog.open(ShareForceDialogComponent);
    }

    printAll(): void {
        PrintUtil.multipagePrint(this.dataService, this.optionsService, this.forceBuilderService.forceUnits());
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