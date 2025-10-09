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

import { Component, computed, OnInit, signal, HostListener, inject, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { UnitSearchComponent } from './components/unit-search/unit-search.component';
import { SvgViewerComponent } from './components/svg-viewer/svg-viewer.component';
import { ForceBuilderViewerComponent } from './components/force-builder-viewer/force-builder-viewer.component';
import { DataService } from './services/data.service';
import { DbService } from './services/db.service';
import { ForceBuilderService } from './services/force-builder.service';
import { Unit } from './models/units.model';
import { LayoutService } from './services/layout.service';
import { LayoutModule } from '@angular/cdk/layout';
import { UnitDetailsDialogComponent } from './components/unit-details-dialog/unit-details-dialog.component';
import { OptionsService } from './services/options.service';
import { OptionsDialogComponent } from './components/options-dialog/options-dialog.component';
import { PopupMenuComponent } from './components/popup-menu/popup-menu.component';
import { PrintUtil } from './utils/print.util';
import { LicenseDialogComponent } from './components/license-dialog/license-dialog.component';
import { ToastsComponent } from './components/toasts/toasts.component';
import { WsService } from './services/ws.service';
import { ToastService } from './services/toast.service';
import { Dialog } from '@angular/cdk/dialog';
import { BetaDialogComponent } from './components/beta-dialog/beta-dialog.component';
import { ForceLoadDialogComponent } from './components/force-load-dialog/force-load-dialog.component';
import { UpdateButtonComponent } from './components/update-button/update-button.component';


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
        UnitSearchComponent,
        SvgViewerComponent,
        ForceBuilderViewerComponent,
        LayoutModule,
        PopupMenuComponent,
        UpdateButtonComponent
    ],
    templateUrl: './app.html',
    styleUrl: './app.scss'
})
export class App implements OnInit {
    private swUpdate = inject(SwUpdate);
    protected dataService = inject(DataService);
    private forceBuilderService = inject(ForceBuilderService);
    protected layoutService = inject(LayoutService);
    private wsService = inject(WsService);
    private dialog = inject(Dialog);
    private toastService = inject(ToastService);
    private optionsService = inject(OptionsService);

    private lastUpdateCheck: number = 0;
    private updateCheckInterval = 60 * 60 * 1000; // 1 hour
    protected title = 'mekbay';
    protected updateAvailable = signal(false);

    isOverlayVisible = computed(() => {
        return this.layoutService.isMobile() && (this.layoutService.isMenuOpen() || this.layoutService.isMenuDragging());
    });

    popupMenuOptions = [
        { label: 'Load Force', value: 'load' },
        { separator: true },
        { label: 'Options', value: 'options' }
    ];

    constructor() {
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
    }

    
    hasUnits = computed(() => this.forceBuilderService.forceUnits().length > 0);
    selectedUnit = computed(() => this.forceBuilderService.selectedUnit());
    isCloudForceLoading = computed(() => this.dataService.isCloudForceLoading());
    @HostListener('window:online')
    onOnline() {
        console.log('Back online, checking for updates...');
        this.checkForUpdate();
    }

    @HostListener('window:focus')
    onFocus() {
        console.log('App focused, checking for updates...');
        this.checkForUpdate();
    }

    private async checkForUpdate() {
        const now = Date.now();
        // Prevent too frequent checks
        if (now - this.lastUpdateCheck < (this.updateCheckInterval / 4)) {
            return;
        }
        this.lastUpdateCheck = now;

        if (this.swUpdate.isEnabled) {
            try {
                const updateFound = await this.swUpdate.checkForUpdate();
                if (updateFound) {
                    this.updateAvailable.set(true);
                }
            } catch (err) {
                console.error('Error checking for updates:', err);
            }
        }
    }

    async ngOnInit() {
        document.addEventListener('contextmenu', (event) => event.preventDefault());
        await this.dataService.initialize();
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
        if (this.dataService.isDataReady()) {
            const params = new URLSearchParams(window.location.search);
            const sharedUnitName = params.get('shareUnit');
            if (sharedUnitName) {
                // Find the unit by model name (decode first)
                const unitNameDecoded = decodeURIComponent(sharedUnitName);
                const unit = this.dataService.getUnitByName(unitNameDecoded);
                if (unit) {
                    this.showSingleUnitDetails(unit);
                }
            }
        }
    }

    ngOnDestroy() {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }

    beforeUnloadHandler = (event: BeforeUnloadEvent) => {
        if (this.forceBuilderService.forceUnits().length > 0) {
            event.preventDefault();
            return '';
        }
        // No units, allow navigation without warning
        return undefined;
    };


    reloadForUpdate(): void {
        window.location.reload();
    }

    showLicenseDialog(): void {
        this.dialog.open(LicenseDialogComponent);
    }

    showOptionsDialog(): void {
        this.dialog.open(OptionsDialogComponent);
    }

    showBetaDialog(): void {
        this.dialog.open(BetaDialogComponent);
    }

    showSingleUnitDetails(unit: Unit) {
        const ref = this.dialog.open(UnitDetailsDialogComponent, {
            data: {
                unitList: [unit],
                unitIndex: 0,
                hideAddButton: false
            }
        });

        ref.closed.subscribe(() => {
            this.removeShareUnitParam();
        });
        ref.componentInstance?.add.subscribe(unit => {
            this.forceBuilderService.addUnit(unit);
            ref.close();
            this.removeShareUnitParam();
        });
    }

    removeShareUnitParam() {
        const params = new URLSearchParams(window.location.search);
        params.delete('shareUnit');
        const newUrl =
            window.location.pathname +
            (params.toString() ? '?' + params.toString() : '') +
            window.location.hash;
        window.history.replaceState({}, '', newUrl);
    }

    toggleMenu() {
        this.layoutService.toggleMenu();
    }

    closeMenu() {
        this.layoutService.closeMenu();
    }

    async onMenuSelected(option: string) {
        switch (option) {
            case 'new': {
                if (await this.forceBuilderService.createNewForce()) {
                    this.layoutService.closeMenu();
                }
                break;
            }
            case 'rename': {
                this.forceBuilderService.promptChangeForceName();
                break;
            }
            case 'load': {
                const ref = this.dialog.open(ForceLoadDialogComponent);
                ref.componentInstance?.load.subscribe(force => {
                    this.forceBuilderService.loadForce(force);
                    ref.close();
                });
                break;
            }
            case 'options': {
                this.dialog.open(OptionsDialogComponent);
                break;
            }
            case 'print': {
                PrintUtil.multipagePrint(this.dataService, this.forceBuilderService.forceUnits());
                break;
            }
        }
    }
}