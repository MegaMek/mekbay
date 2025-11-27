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

import { Component, computed, signal, HostListener, inject, effect, ChangeDetectionStrategy, viewChild, ElementRef, afterNextRender, Injector, untracked, DestroyRef } from '@angular/core';

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
import { UpdateButtonComponent } from './components/update-button/update-button.component';
import { UnitSearchFiltersService } from './services/unit-search-filters.service';
import { DomPortal, PortalModule } from '@angular/cdk/portal';
import { OverlayModule } from '@angular/cdk/overlay';
import { APP_VERSION_STRING } from './build-meta';
import { copyTextToClipboard } from './utils/clipboard.util';
import { LoggerService } from './services/logger.service';
import { isIOS, isRunningStandalone } from './utils/platform.util';

/*
 * Author: Drake
 */
@Component({
    selector: 'app-root',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
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
    protected showInstallButton = signal(false);
    private deferredPrompt: any;


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

        // iOS doesn't fire beforeinstallprompt, so we check manually
        if (isIOS() && !isRunningStandalone()) {
            this.showInstallButton.set(true);
        }

        window.addEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
        window.addEventListener('appinstalled', this.appInstalledHandler);
        document.addEventListener('contextmenu', this.contextMenuHandler);
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
                        this.unitSearchComponentRef()?.buttonOnly.set(false);
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
        inject(DestroyRef).onDestroy(() => {
            this.removeBeforeUnloadHandler();
            window.removeEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
            window.removeEventListener('appinstalled', this.appInstalledHandler);
            document.removeEventListener('contextmenu', this.contextMenuHandler);
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

    private beforeInstallPromptHandler = (e: any) => {
        e.preventDefault();
        this.deferredPrompt = e;
        this.showInstallButton.set(true);
    };

    private appInstalledHandler = () => {
        this.showInstallButton.set(false);
        this.deferredPrompt = null;
        this.logger.info('PWA was installed');
    };

    private contextMenuHandler = (event: Event) => {
        event.preventDefault();
    };

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

    async installPwa() {
        if (isIOS()) {
            this.dialogService.showNoticeHtml(`To install on iOS, tap the 
                <svg style="position: relative; top: 0.4em; margin-left: -0.2em; margin-right: -0.3em;" fill="currentColor" width="1.5em" height="1.5em" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg"><path d="M30.3 13.7L25 8.4l-5.3 5.3-1.4-1.4L25 5.6l6.7 6.7z"/><path d="M24 7h2v21h-2z"/><path d="M35 40H15c-1.7 0-3-1.3-3-3V19c0-1.7 1.3-3 3-3h7v2h-7c-.6 0-1 .4-1 1v18c0 .6.4 1 1 1h20c.6 0 1-.4 1-1V19c0-.6-.4-1-1-1h-7v-2h7c1.7 0 3 1.3 3 3v18c0 1.7-1.3 3-3 3z"/></svg>
                "Share" button and select 
                <svg style="position: relative; top: 0.1em; margin-left: 0.1em;" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" style="display: inline-block; vertical-align: -0.125em; margin-right: 0.2em;"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
                "Add to Home Screen".`, 'App Installation');
            return;
        }

        if (!this.deferredPrompt) {
            return;
        }
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        this.logger.info(`User response to the install prompt: ${outcome}`);
        this.deferredPrompt = null;
        this.showInstallButton.set(false);
    }

    public removeBeforeUnloadHandler() {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
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