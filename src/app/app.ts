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

import { Component, computed, signal, inject, effect, ChangeDetectionStrategy, viewChild, type ElementRef, afterNextRender, Injector, DestroyRef } from '@angular/core';

import { UnitSearchComponent } from './components/unit-search/unit-search.component';
import { PageViewerComponent } from './components/page-viewer/page-viewer.component';
import { AlphaStrikeViewerComponent } from './components/alpha-strike-viewer/alpha-strike-viewer.component';
import { DataService } from './services/data.service';
import { ForceBuilderService } from './services/force-builder.service';
import type { Unit } from './models/units.model';
import { LayoutService } from './services/layout.service';
import { LayoutModule } from '@angular/cdk/layout';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from './components/unit-details-dialog/unit-details-dialog.component';
import { OptionsService } from './services/options.service';
import { OptionsDialogComponent } from './components/options-dialog/options-dialog.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ConnectionStatusBadgeComponent } from './components/connection-status-badge/connection-status-badge.component';
import { ModeSwitchComponent } from './components/mode-switch/mode-switch.component';
import { LicenseDialogComponent } from './components/license-dialog/license-dialog.component';
import { ToastsComponent } from './components/toasts/toasts.component';
import { SavedSearchesService } from './services/saved-searches.service';
import { WsService } from './services/ws.service';
import { ToastService } from './services/toast.service';
import { DialogsService } from './services/dialogs.service';
import { BetaDialogComponent } from './components/beta-dialog/beta-dialog.component';
import { UnitSearchFiltersService } from './services/unit-search-filters.service';
import { DomPortal, PortalModule } from '@angular/cdk/portal';
import { OverlayModule } from '@angular/cdk/overlay';
import { APP_VERSION_STRING, BUILD_BRANCH } from './build-meta';
import { LoggerService } from './services/logger.service';
import { isAndroid, isIOS, isRunningStandalone } from './utils/platform.util';
import { GameService } from './services/game.service';
import { AccountAuthService } from './services/account-auth.service';
import { AppUpdateService } from './services/app-update.service';
import { LoadingSpinnerComponent } from './components/loading-spinner/loading-spinner.component';

import { GameSystem } from './models/common.model';
import { Router, RouterOutlet } from '@angular/router';
import { UrlService } from './services/url.service';

const ANDROID_PWA_BACK_EXIT_HISTORY_STATE_KEY = 'mekbayAndroidPwaBackExit';
const ANDROID_PWA_BACK_RESTORE_GUARD_MS = 1000;
const PENDING_UPDATE_RELOAD_AFTER_NO_FOCUS_MS = 6 * 60 * 60 * 1000; // 6 hours

/*
 * Author: Drake
 */
@Component({
    selector: 'app-root',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    ToastsComponent,
    PageViewerComponent,
    AlphaStrikeViewerComponent,
    LayoutModule,
    SidebarComponent,
    ConnectionStatusBadgeComponent,
    ModeSwitchComponent,
    UnitSearchComponent,
    OverlayModule,
    PortalModule,
    LoadingSpinnerComponent,
    RouterOutlet
],
    templateUrl: './app.html',
    styleUrl: './app.scss',
    host: {
        '(window:online)': 'onOnline()',
        '(window:focus)': 'onFocus()',
        '(window:keydown.escape)': 'closeHomeActionsPanel()'
    }
})
export class App {
    logger = inject(LoggerService);
    protected dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    protected layoutService = inject(LayoutService);
    protected appUpdateService = inject(AppUpdateService);
    private wsService = inject(WsService);
    private dialogService = inject(DialogsService);
    private toastService = inject(ToastService);
    protected optionsService = inject(OptionsService);
    public unitSearchFiltersService = inject(UnitSearchFiltersService);
    public injector = inject(Injector);
    public gameService = inject(GameService);
    private accountAuthService = inject(AccountAuthService);
    private router = inject(Router);
    private urlService = inject(UrlService);
    private savedSearchesService = inject(SavedSearchesService);
    private destroyRef = inject(DestroyRef);

    protected GameSystem = GameSystem;
    protected buildInfo = APP_VERSION_STRING;
    protected isMainBuild = BUILD_BRANCH === 'main';
    private updateCheckTimeoutId: number | null = null;
    protected showInstallButton = signal(false);
    protected homeActionsPanelOpen = signal(false);
    private deferredPrompt: any;
    private urlAtLastBlur = this.getCurrentAppUrl();
    private lastHandledCapturedUrl: string | null = null;
    private lastHandledCapturedUrlAt = 0;
    private readonly capturedUrlDedupWindowMs = 2000;
    private focusLostAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    private androidPwaBackExitEnabled = false;
    private androidPwaBackRestoring = false;
    private androidPwaBackRestoreTimeoutId: number | null = null;
    private readonly keyboardNavigationKeys = new Set([
        'Tab',
        'ArrowUp',
        'ArrowRight',
        'ArrowDown',
        'ArrowLeft',
        'Home',
        'End',
        'PageUp',
        'PageDown',
    ]);


    private readonly unitSearchContainer = viewChild.required<ElementRef>('unitSearchContainer');
    public readonly unitSearchComponentRef = viewChild(UnitSearchComponent);
    protected unitSearchPortal: DomPortal<ElementRef> | null = null;
    private currentPortalOutlet: 'extended' | 'forceBuilder' | 'main' | null = null;
    protected unitSearchPortalMain = signal<DomPortal<any> | undefined>(undefined);
    protected unitSearchPortalExtended = signal<DomPortal<any> | undefined>(undefined);
    protected unitSearchPortalForceBuilder = signal<DomPortal<any> | undefined>(undefined);

    constructor() {
        // if ("virtualKeyboard" in navigator) {
        //     (navigator as any).virtualKeyboard.overlaysContent = true; // Opt out of the automatic handling.
        // }
        this.dataService.initialize();
        this.savedSearchesService.initialize();
        this.savedSearchesService.registerWsHandlers();
        void this.accountAuthService.handleOAuthRedirectReturn();
        
        // Set up foreign tag import dialog callback
        this.unitSearchFiltersService.setForeignTagDialogCallback(
            (publicId, tagNames) => this.showForeignTagImportDialog(tagNames)
        );

        // iOS doesn't fire beforeinstallprompt, so we check manually
        if (isIOS() && !isRunningStandalone()) {
            this.showInstallButton.set(true);
        }

        window.addEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
        window.addEventListener('appinstalled', this.appInstalledHandler);
        document.addEventListener('contextmenu', this.contextMenuHandler);
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
        window.addEventListener('blur', this.onBlur);
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
        window.addEventListener('keydown', this.keyboardNavigationHandler, true);
        window.addEventListener('pointerdown', this.pointerNavigationHandler, true);
        window.addEventListener('mousedown', this.pointerNavigationHandler, true);
        window.addEventListener('touchstart', this.pointerNavigationHandler, true);
        this.initializeAndroidPwaBackExitHandling();
        // window.addEventListener('popstate', this.historyNavigationHandler);
        // if ('serviceWorker' in navigator) {
        //     navigator.serviceWorker.addEventListener('message', this.serviceWorkerMessageHandler);
        // }
        this.scheduleUpdateCheckTimer();
        this.wsService.setGlobalErrorHandler((msg: string) => {
            this.toastService.showToast(msg, 'error');
        });
        effect(() => {
            const colorMode = this.optionsService.options().sheetsColor;
            document.documentElement.classList.toggle('night-mode', (colorMode === 'night'));
        });
        effect(() => {
            if (!this.dataService.isDataReady() || this.optionsService.options().availabilitySource !== 'megamek') {
                return;
            }

            void this.dataService.ensureMegaMekAvailabilityCatalogInitialized();
        });
        effect(() => {
            const unitSearchContainer = this.unitSearchContainer();
            const hasForces = this.hasForces();
            const expandedView = this.unitSearchFiltersService.expandedView();
            
            if (unitSearchContainer) {
                // Create portal if needed
                if (!this.unitSearchPortal) {
                    this.unitSearchPortal = new DomPortal(unitSearchContainer);
                }
                
                // Determine target outlet
                type OutletName = 'extended' | 'forceBuilder' | 'main';
                let targetOutlet: OutletName;
                if (expandedView) {
                    targetOutlet = 'extended';
                } else if (hasForces) {
                    targetOutlet = 'forceBuilder';
                } else {
                    targetOutlet = 'main';
                }
                
                // Only update if target changed
                if (this.currentPortalOutlet === targetOutlet) {
                    return;
                }
                
                // Clear previous outlet
                if (this.currentPortalOutlet) {
                    switch (this.currentPortalOutlet) {
                        case 'extended':
                            this.unitSearchPortalExtended.set(undefined);
                            break;
                        case 'forceBuilder':
                            this.unitSearchPortalForceBuilder.set(undefined);
                            break;
                        case 'main':
                            this.unitSearchPortalMain.set(undefined);
                            break;
                    }
                }
                
                // Detach portal if attached
                if (this.unitSearchPortal.isAttached) {
                    this.unitSearchPortal.detach();
                }
                
                // Set new outlet
                this.currentPortalOutlet = targetOutlet;
                switch (targetOutlet) {
                    case 'extended':
                        this.unitSearchPortalExtended.set(this.unitSearchPortal);
                        break;
                    case 'forceBuilder':
                        this.unitSearchPortalForceBuilder.set(this.unitSearchPortal);
                        break;
                    case 'main':
                        this.unitSearchPortalMain.set(this.unitSearchPortal);
                        this.unitSearchComponentRef()?.buttonOnly.set(false);
                        break;
                }
            }
        });
        let initialShareHandled = false;
        effect(() => {
            if (this.dataService.isDataReady() && !initialShareHandled) {
                initialShareHandled = true;
                // Routed pages (/toe, /forcegenerator, /collection) are handled
                // natively by the router; only query-param-driven startup actions
                // are handled here, based on the initial URL captured at startup.
                const onHomePage = this.urlService.initialPathname.replace(/\/+$/, '') === '';
                const organizationId = this.urlService.getInitialParam('toe');
                const sharedUnitName = this.urlService.getInitialParam('shareUnit');
                const tab = this.urlService.getInitialParam('tab') ?? undefined;
                if (onHomePage && organizationId) {
                    // Legacy ?toe=... link on the home page: open the TO&E page
                    void this.forceBuilderService.showForceOrgDialog(organizationId);
                } else if (onHomePage && sharedUnitName) {
                    const unit = this.dataService.getUnitByName(sharedUnitName);
                    if (unit) {
                        this.showSingleUnitDetails(unit, tab);
                    }
                } else if (onHomePage) {
                    afterNextRender(() => {
                        // Don't focus if loading forces
                        if (this.urlService.hasInitialParam('instance') || this.urlService.hasInitialParam('units')) return;
                        this.unitSearchComponentRef()?.focusInput();
                    }, { injector: this.injector });
                }

                // Process any pending foreign tags from URL (async, don't block)
                this.unitSearchFiltersService.processPendingForeignTags();
            }
        });
        this.destroyRef.onDestroy(() => {
            this.clearUpdateCheckTimer();
            this.removeBeforeUnloadHandler();
            window.removeEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
            window.removeEventListener('appinstalled', this.appInstalledHandler);
            document.removeEventListener('contextmenu', this.contextMenuHandler);
            window.removeEventListener('blur', this.onBlur);
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
            window.removeEventListener('keydown', this.keyboardNavigationHandler, true);
            window.removeEventListener('pointerdown', this.pointerNavigationHandler, true);
            window.removeEventListener('mousedown', this.pointerNavigationHandler, true);
            window.removeEventListener('touchstart', this.pointerNavigationHandler, true);
            this.removeAndroidPwaBackExitHandling();
            // window.removeEventListener('popstate', this.historyNavigationHandler);
            // if ('serviceWorker' in navigator) {
            //     navigator.serviceWorker.removeEventListener('message', this.serviceWorkerMessageHandler);
            // }
        });
    }

    hasForces = this.forceBuilderService.hasForces;

    private readonly keyboardNavigationHandler = (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }

        if (this.keyboardNavigationKeys.has(event.key)) {
            document.documentElement.classList.add('keyboard-navigation');
        }
    };

    private readonly pointerNavigationHandler = () => {
        document.documentElement.classList.remove('keyboard-navigation');
    };

    private initializeAndroidPwaBackExitHandling(): void {
        if (!this.shouldHandleAndroidPwaBackExit()) {
            return;
        }

        this.androidPwaBackExitEnabled = true;
        window.addEventListener('popstate', this.androidPwaBackExitHandler);
        this.pushAndroidPwaBackExitState();
    }

    private removeAndroidPwaBackExitHandling(): void {
        window.removeEventListener('popstate', this.androidPwaBackExitHandler);
        this.clearAndroidPwaBackRestoreGuard();
        this.androidPwaBackExitEnabled = false;
    }

    private shouldHandleAndroidPwaBackExit(): boolean {
        // iOS web apps do not expose the same app-closing Back button path, and window.close() is not reliable there.
        return isAndroid()
            && isRunningStandalone()
            && typeof window.history.pushState === 'function'
            && typeof window.history.forward === 'function';
    }

    private pushAndroidPwaBackExitState(): void {
        if (this.isAndroidPwaBackExitState(window.history.state)) {
            return;
        }

        try {
            window.history.pushState(
                this.withAndroidPwaBackExitState(window.history.state),
                '',
                window.location.href
            );
        } catch (err) {
            window.removeEventListener('popstate', this.androidPwaBackExitHandler);
            this.androidPwaBackExitEnabled = false;
            this.logger.warn('Unable to initialize Android PWA back handling: ' + err);
        }
    }

    private replaceCurrentHistoryState(url: string): void {
        const state = this.androidPwaBackExitEnabled
            ? this.withAndroidPwaBackExitState(window.history.state)
            : null;
        window.history.replaceState(state, '', url);
    }

    private withAndroidPwaBackExitState(state: unknown): Record<string, unknown> {
        const stateObject = state && typeof state === 'object' && !Array.isArray(state)
            ? state as Record<string, unknown>
            : {};
        return { ...stateObject, [ANDROID_PWA_BACK_EXIT_HISTORY_STATE_KEY]: true };
    }

    private isAndroidPwaBackExitState(state: unknown): boolean {
        return !!state
            && typeof state === 'object'
            && (state as Record<string, unknown>)[ANDROID_PWA_BACK_EXIT_HISTORY_STATE_KEY] === true;
    }

    private readonly androidPwaBackExitHandler = (event: PopStateEvent) => {
        if (!this.androidPwaBackExitEnabled) {
            return;
        }

        if (this.androidPwaBackRestoring) {
            this.androidPwaBackRestoring = false;
            this.clearAndroidPwaBackRestoreGuard();
            return;
        }

        if (this.isAndroidPwaBackExitState(event.state)) {
            return;
        }

        this.logger.info('[PWA] Android back button reached app root; closing standalone window.');
        this.androidPwaBackRestoring = true;
        try {
            window.history.forward();
            this.androidPwaBackRestoreTimeoutId = window.setTimeout(() => {
                this.androidPwaBackRestoring = false;
                this.androidPwaBackRestoreTimeoutId = null;
            }, ANDROID_PWA_BACK_RESTORE_GUARD_MS);
        } catch {
            this.androidPwaBackRestoring = false;
        }
        this.closeStandaloneWindow();
    };

    private clearAndroidPwaBackRestoreGuard(): void {
        if (this.androidPwaBackRestoreTimeoutId !== null) {
            window.clearTimeout(this.androidPwaBackRestoreTimeoutId);
            this.androidPwaBackRestoreTimeoutId = null;
        }
    }

    private closeStandaloneWindow(): void {
        window.close();
    }

    isCloudForceLoading = computed(() => this.dataService.isCloudForceLoading());

    onOnline() {
        void this.checkForUpdateAfterFocusAndRestartTimer();
    }

    onFocus() {
        this.checkForUpdateAfterResume();
    }

    private onBlur = () => {
        this.urlAtLastBlur = this.getCurrentAppUrl();
        this.markFocusLost();
    };

    private readonly visibilityChangeHandler = () => {
        if (document.visibilityState === 'hidden') {
            this.markFocusLost();
            return;
        }

        if (document.visibilityState === 'visible') {
            this.checkForUpdateAfterResume();
        }
    };

    private checkForUpdateAfterResume(): void {
        const focusLostAt = this.focusLostAt;
        this.focusLostAt = null;

        if (focusLostAt !== null
            && (Date.now() - focusLostAt) >= PENDING_UPDATE_RELOAD_AFTER_NO_FOCUS_MS
            && this.appUpdateService.updatePending()) {
            void this.appUpdateService.restartForUpdate();
            return;
        }

        void this.checkForUpdateAfterFocusAndRestartTimer();
    }

    private markFocusLost(): void {
        this.focusLostAt ??= Date.now();
    }

    private getCurrentAppUrl(): string {
        return `${window.location.pathname}${window.location.search}`;
    }

    private shouldSkipDuplicateCapturedUrl(parsed: URL): boolean {
        const normalizedUrl = `${parsed.pathname}${parsed.search}`;
        const now = Date.now();
        if (this.lastHandledCapturedUrl === normalizedUrl && (now - this.lastHandledCapturedUrlAt) < this.capturedUrlDedupWindowMs) {
            this.logger.info('[PWA] Skipping duplicate captured URL: ' + normalizedUrl);
            return true;
        }
        this.lastHandledCapturedUrl = normalizedUrl;
        this.lastHandledCapturedUrlAt = now;
        return false;
    }

    private scheduleUpdateCheckTimer(): void {
        this.clearUpdateCheckTimer();
        this.updateCheckTimeoutId = window.setTimeout(async () => {
            await this.appUpdateService.checkForUpdate({ force: true });
            this.scheduleUpdateCheckTimer();
        }, this.appUpdateService.updateCheckIntervalMs);
    }

    private clearUpdateCheckTimer(): void {
        if (this.updateCheckTimeoutId !== null) {
            window.clearTimeout(this.updateCheckTimeoutId);
            this.updateCheckTimeoutId = null;
        }
    }

    private async checkForUpdateAfterFocusAndRestartTimer(): Promise<void> {
        const checkPerformed = await this.appUpdateService.checkForUpdateAfterFocus();
        if (checkPerformed) {
            this.scheduleUpdateCheckTimer();
        }
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
        const target = event.target;
        const targetElement = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
        if (targetElement?.closest('input, textarea, .allow-select, [data-allow-native-context-menu="true"]')) {
            return;
        }

        event.preventDefault();
    };

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
        if (!this.appUpdateService.reloadingForUpdate() && this.hasBlockingUnsavedWork()) {
            event.preventDefault();
            return 'You have unsaved changes. Are you sure you want to leave?';
        }
        return undefined;
    };

    private hasBlockingUnsavedWork(): boolean {
        if (this.dataService.hasPendingCloudSaves()) {
            return true;
        }

        const loadedForces = this.forceBuilderService.loadedForces();
        return loadedForces.some(forceSlot => forceSlot.force.units().length > 0 && !forceSlot.force.instanceId());
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

    showNextDialog(): void {
        this.dialogService.showNextDialog();
    }

    showLoadForceDialog(): void {
        this.forceBuilderService.showLoadForceDialog();
    }

    showCollectionDialog(): void {
        void this.router.navigate(['/collection'], { queryParamsHandling: 'preserve' });
    }

    showForceGeneratorDialog(): void {
        void this.forceBuilderService.showForceGeneratorDialog();
    }

    openHomeActionsPanel(): void {
        this.homeActionsPanelOpen.set(true);
    }

    closeHomeActionsPanel(): void {
        this.homeActionsPanelOpen.set(false);
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
                if (ref.componentInstance?.tabs().includes(tab)) {
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

    
    
    /**
     * Show the foreign tag import dialog and wait for user choice.
     * @param tagNames Array of tag names being imported
     * @returns User's choice: 'ignore', 'temporary', or 'subscribe'
     */
    async showForeignTagImportDialog(tagNames: string[]): Promise<'ignore' | 'temporary' | 'subscribe'> {
        const tagList = tagNames.join(', ');
        return this.dialogService.choose<'ignore' | 'temporary' | 'subscribe'>(
            'Import Foreign Tags',
            `The URL contains tags from another user: ${tagList}.\n\nHow would you like to handle these tags?`,
            [
                { label: 'IGNORE', value: 'ignore' },
                { label: 'TEMPORARY', value: 'temporary' },
                { label: 'SUBSCRIBE', value: 'subscribe' }
            ],
            'ignore'
        );
    }
}