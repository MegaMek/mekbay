/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Component, computed, signal, HostListener, inject, effect, ChangeDetectionStrategy, viewChild, ElementRef, afterNextRender, Injector, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { UnitSearchComponent } from './components/unit-search/unit-search.component';
import { SvgViewerComponent } from './components/svg-viewer/svg-viewer.component';
import { DataService } from './services/data.service';
import { ForceBuilderService } from './services/force-builder.service';
import { Unit } from './models/units.model';
import { LayoutService } from './services/layout.service';
import { LayoutModule } from '@angular/cdk/layout';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from './components/unit-details-dialog/unit-details-dialog.component';
import { OptionsService } from './services/options.service';
import { OptionsDialogComponent } from './components/options-dialog/options-dialog.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { LicenseDialogComponent } from './components/license-dialog/license-dialog.component';
import { ToastsComponent } from './components/toasts/toasts.component';
import { WsService } from './services/ws.service';
import { ToastService } from './services/toast.service';
import { DialogsService } from './services/dialogs.service';
import { BetaDialogComponent } from './components/beta-dialog/beta-dialog.component';
import { ForceLoadDialogComponent } from './components/force-load-dialog/force-load-dialog.component';
import { UpdateButtonComponent } from './components/update-button/update-button.component';
import { UnitSearchFiltersService } from './services/unit-search-filters.service';
import { DomPortal, PortalModule } from '@angular/cdk/portal';
import { OverlayModule } from '@angular/cdk/overlay';
import { APP_VERSION_STRING } from './build-meta';
import { copyTextToClipboard } from './utils/clipboard.util';
import { LoadForceEntry } from './models/load-force-entry.model';
import { LoggerService } from './services/logger.service';


/*
 * Author: Drake
 */
@Component({
    selector: 'app-root',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        ToastsComponent,
        SvgViewerComponent,
        LayoutModule,
        UpdateButtonComponent,
        SidebarComponent,
        UnitSearchComponent,
        OverlayModule,
        PortalModule
    ],
    templateUrl: './app.html',
    styleUrl: './app.scss'
})
export class App {
    logger = inject(LoggerService);
    private swUpdate = inject(SwUpdate);
    protected dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    protected layoutService = inject(LayoutService);
    private wsService = inject(WsService);
    private dialogService = inject(DialogsService);
    private toastService = inject(ToastService);
    private optionsService = inject(OptionsService);
    public unitSearchFilter = inject(UnitSearchFiltersService);
    public injector = inject(Injector);

    protected buildInfo = APP_VERSION_STRING;
    private lastUpdateCheck: number = 0;
    private updateCheckInterval = 60 * 60 * 1000; // 1 hour
    protected title = 'mekbay';
    protected updateAvailable = signal(false);


    private readonly unitSearchContainer = viewChild.required<ElementRef>('unitSearchContainer');
    public readonly unitSearchComponentRef = viewChild(UnitSearchComponent);
    public readonly sidebar = viewChild(SidebarComponent);
    protected unitSearchPortal!: DomPortal<ElementRef>;
    protected unitSearchPortalMain!: DomPortal<any>;
    protected unitSearchPortalExtended!: DomPortal<any>;
    protected unitSearchPortalForceBuilder = signal<DomPortal<any> | undefined>(undefined);

    constructor() {
        // if ("virtualKeyboard" in navigator) {
        //     (navigator as any).virtualKeyboard.overlaysContent = true; // Opt out of the automatic handling.
        // }
        this.dataService.initialize();
        document.addEventListener('contextmenu', (event) => event.preventDefault());
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
        if (this.swUpdate.isEnabled) {
            setInterval(() => this.checkForUpdate(), this.updateCheckInterval);
            this.checkForUpdate();
        }
        this.wsService.setGlobalErrorHandler((msg: string) => {
            this.toastService.show(msg, 'error');
        });
        effect(() => {
            const colorMode = this.optionsService.options().sheetsColor;
            document.documentElement.classList.toggle('night-mode', (colorMode === 'night'));
        });
        effect(() => {
            const unitSearchContainer = this.unitSearchContainer();
            if (unitSearchContainer) {
                if (this.unitSearchPortal?.isAttached) {
                    this.unitSearchPortal.detach();
                }
                this.unitSearchPortal = new DomPortal(unitSearchContainer);
                if (this.unitSearchFilter.expandedView()) {
                    this.unitSearchPortalExtended = this.unitSearchPortal;
                } else {
                    if (this.sidebar()) {
                        this.unitSearchPortalForceBuilder.set(this.unitSearchPortal);
                    } else {
                        this.unitSearchPortalMain = this.unitSearchPortal;
                    }
                }
            }
        });
        let initialShareHandled = false;
        effect(() => {
            if (this.dataService.isDataReady() && !initialShareHandled) {
                initialShareHandled = true;
                const params = new URLSearchParams(window.location.search);
                const sharedUnitName = params.get('shareUnit');
                const tab = params.get('tab') ?? undefined;
                if (sharedUnitName) {
                    // Find the unit by model name (decode first)
                    const unitNameDecoded = decodeURIComponent(sharedUnitName);
                    const unit = this.dataService.getUnitByName(unitNameDecoded);
                    if (unit) {
                        this.showSingleUnitDetails(unit, tab);
                    }
                } else {
                    afterNextRender(() => {
                        const params = new URLSearchParams(window.location.search);
                        if (params.has('instanceId') || params.has('units')) return; // Don't focus if loading a force
                        this.unitSearchComponentRef()?.focusInput();
                    }, { injector: this.injector });
                }
            }
        });
    }

    hasUnits = computed(() => this.forceBuilderService.forceUnits().length > 0);
    selectedUnit = computed(() => this.forceBuilderService.selectedUnit());
    isCloudForceLoading = computed(() => this.dataService.isCloudForceLoading());
    
    @HostListener('window:online')
    onOnline() {
        this.checkForUpdate();
    }

    @HostListener('window:focus')
    onFocus() {
        this.checkForUpdate();
    }

    private async checkForUpdate() {
        const now = Date.now();
        // Prevent too frequent checks
        if (now - this.lastUpdateCheck < (this.updateCheckInterval / 4)) {
            return;
        }
        this.logger.info('Checking for updates...');
        this.lastUpdateCheck = now;

        if (this.swUpdate.isEnabled) {
            try {
                const updateFound = await this.swUpdate.checkForUpdate();
                if (updateFound) {
                    this.updateAvailable.set(true);
                }
            } catch (err) {
                this.logger.error('Error checking for updates:' + err);
            }
        }
    }

    public removeBeforeUnloadHandler() {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }

    ngOnDestroy() {
        this.removeBeforeUnloadHandler();
    }

    beforeUnloadHandler = (event: BeforeUnloadEvent) => {
        if (this.dataService.hasPendingCloudSaves()) {
            event.preventDefault();
            return 'Cloud sync is still pending. Are you sure you want to leave?';
        }
        if (this.forceBuilderService.forceUnits().length > 0) {
            if (!this.forceBuilderService.force.instanceId()) {
                // We have units but we don't have an instanceId? This is not yet saved.
                event.preventDefault();
                return 'You have unsaved changes in your force. Are you sure you want to leave?';
            }
        }
        // No units, allow navigation without warning
        return undefined;
    };


    reloadForUpdate(): void {
        window.location.reload();
    }

    copyBuildInfo(): void {
        if (!copyTextToClipboard(this.buildInfo)) return;
        this.toastService.show('Build info copied to clipboard.', 'info');
    }

    showLicenseDialog(): void {
        this.dialogService.createDialog(LicenseDialogComponent);
    }

    showOptionsDialog(): void {
        this.dialogService.createDialog(OptionsDialogComponent);
    }

    showBetaDialog(): void {
        this.dialogService.createDialog(BetaDialogComponent);
    }

    showLoadForceDialog(): void {
        this.forceBuilderService.showLoadForceDialog();
    }

    showSingleUnitDetails(unit: Unit, tab?: string) {
        const ref = this.dialogService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: [unit],
                unitIndex: 0
            }
        });

        // Restore tab if provided
        if (tab && ref.componentInstance) {
            afterNextRender(() => {
                if (ref.componentInstance?.tabs.includes(tab)) {
                    ref.componentInstance.activeTab.set(tab);
                }
            }, { injector: this.injector });
        }
    }

    toggleMenu() {
        this.layoutService.toggleMenu();
    }

    closeMenu() {
        this.layoutService.closeMenu();
    }
}