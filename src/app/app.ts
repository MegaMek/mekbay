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

import { SwUpdate } from '@angular/service-worker';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { LicenseDialogComponent } from './components/license-dialog/license-dialog.component';
import { ToastsComponent } from './components/toasts/toasts.component';
import { SavedSearchesService } from './services/saved-searches.service';
import { WsService } from './services/ws.service';
import { ToastService } from './services/toast.service';
import { DialogsService } from './services/dialogs.service';
import { BetaDialogComponent } from './components/beta-dialog/beta-dialog.component';
import { UpdateButtonComponent } from './components/update-button/update-button.component';
import { UnitSearchFiltersService } from './services/unit-search-filters.service';
import { DomPortal, PortalModule } from '@angular/cdk/portal';
import { OverlayModule } from '@angular/cdk/overlay';
import { APP_VERSION_STRING, BUILD_BRANCH } from './build-meta';
import { LoggerService } from './services/logger.service';
import { isIOS, isRunningStandalone } from './utils/platform.util';
import { GameService } from './services/game.service';
import { AccountAuthService } from './services/account-auth.service';

import { GameSystem } from './models/common.model';
import { UrlStateService } from './services/url-state.service';

const SW_UPDATE_RELOAD_HASH_STORAGE_KEY = 'mekbay:sw-update-reload-hash';

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
    UpdateButtonComponent,
    SidebarComponent,
    UnitSearchComponent,
    OverlayModule,
    PortalModule
],
    templateUrl: './app.html',
    styleUrl: './app.scss',
    host: {
        '(window:online)': 'onOnline()',
        '(window:focus)': 'onFocus()'
    }
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
    protected optionsService = inject(OptionsService);
    public unitSearchFiltersService = inject(UnitSearchFiltersService);
    public injector = inject(Injector);
    public gameService = inject(GameService);
    private accountAuthService = inject(AccountAuthService);
    private urlStateService = inject(UrlStateService);
    private savedSearchesService = inject(SavedSearchesService);
    private destroyRef = inject(DestroyRef);

    protected GameSystem = GameSystem;
    protected buildInfo = APP_VERSION_STRING;
    protected isMainBuild = BUILD_BRANCH === 'main';
    private lastUpdateCheck: number = 0;
    private updateCheckInterval = 60 * 60 * 1000; // 1 hour
    private updateCheckTimeoutId: number | null = null;
    protected updateAvailable = signal(false);
    protected updateAutoReloadEnabled = signal(false);
    protected showInstallButton = signal(false);
    private deferredPrompt: any;
    private urlAtLastBlur = this.getCurrentAppUrl();
    private lastHandledCapturedUrl: string | null = null;
    private lastHandledCapturedUrlAt = 0;
    private readonly capturedUrlDedupWindowMs = 2000;
    private pendingUpdateHash: string | null = null;


    private readonly unitSearchContainer = viewChild.required<ElementRef>('unitSearchContainer');
    public readonly unitSearchComponentRef = viewChild(UnitSearchComponent);
    protected unitSearchPortal: DomPortal<ElementRef> | null = null;
    private currentPortalOutlet: 'extended' | 'forceBuilder' | 'main' | null = null;
    protected unitSearchPortalMain = signal<DomPortal<any> | undefined>(undefined);
    protected unitSearchPortalExtended = signal<DomPortal<any> | undefined>(undefined);
    protected unitSearchPortalForceBuilder = signal<DomPortal<any> | undefined>(undefined);

    constructor() {
        // Register as a URL state consumer - must call markConsumerReady when done reading URL
        this.urlStateService.registerConsumer('app');
        
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
        // window.addEventListener('popstate', this.historyNavigationHandler);
        // if ('serviceWorker' in navigator) {
        //     navigator.serviceWorker.addEventListener('message', this.serviceWorkerMessageHandler);
        // }
        
        if (this.swUpdate.isEnabled) {
            this.swUpdate.versionUpdates
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe((event) => {
                    switch (event.type) {
                        case 'VERSION_DETECTED':
                            this.logger.info('Service worker update detected, downloading...');
                            break;
                        case 'VERSION_READY':
                            this.handleReadyServiceWorkerUpdate(event);
                            break;
                        case 'VERSION_INSTALLATION_FAILED':
                            this.logger.error('Service worker update installation failed: ' + event.error);
                            break;
                        case 'NO_NEW_VERSION_DETECTED':
                            // this.logger.info('No new service worker version detected');
                            break;
                    }
                });
            this.startPeriodicUpdateChecks();
            this.checkForUpdate(true);
        }
        this.wsService.setGlobalErrorHandler((msg: string) => {
            this.toastService.showToast(msg, 'error');
        });
        effect(() => {
            const colorMode = this.optionsService.options().sheetsColor;
            document.documentElement.classList.toggle('night-mode', (colorMode === 'night'));
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
                // Use UrlStateService to get initial URL params (captured before any routing effects)
                const hasProtocolLink = this.urlStateService.hasInitialParam('protocolLink');
                const organizationId = this.urlStateService.getInitialParam('toe');
                const sharedUnitName = this.urlStateService.getInitialParam('shareUnit');
                const tab = this.urlStateService.getInitialParam('tab') ?? undefined;
                if (hasProtocolLink) {
                    void this.handleCapturedUrl(window.location.href, 'protocol');
                } else if (organizationId) {
                    void this.forceBuilderService.showForceOrgDialog(organizationId);
                } else if (sharedUnitName) {
                    const unit = this.dataService.getUnitByName(sharedUnitName);
                    if (unit) {
                        this.showSingleUnitDetails(unit, tab);
                    }
                } else {
                    afterNextRender(() => {
                        // Don't focus if loading forces
                        if (this.urlStateService.hasInitialParam('instance') || this.urlStateService.hasInitialParam('units')) return;
                        this.unitSearchComponentRef()?.focusInput();
                    }, { injector: this.injector });
                }
                // Signal that we're done reading URL state
                this.urlStateService.markConsumerReady('app');
                
                // Process any pending foreign tags from URL (async, don't block)
                this.unitSearchFiltersService.processPendingForeignTags();
            }
        });
        this.destroyRef.onDestroy(() => {
            this.stopPeriodicUpdateChecks();
            this.removeBeforeUnloadHandler();
            window.removeEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
            window.removeEventListener('appinstalled', this.appInstalledHandler);
            document.removeEventListener('contextmenu', this.contextMenuHandler);
            window.removeEventListener('blur', this.onBlur);
            // window.removeEventListener('popstate', this.historyNavigationHandler);
            // if ('serviceWorker' in navigator) {
            //     navigator.serviceWorker.removeEventListener('message', this.serviceWorkerMessageHandler);
            // }
        });
    }

    hasForces = this.forceBuilderService.hasForces;

    isCloudForceLoading = computed(() => this.dataService.isCloudForceLoading());

    onOnline() {
        void this.checkForUpdate();
    }

    onFocus() {
        // TODO: Temporarily disabled, this is for PWA URL handling but is causing issues with normal navigation.
        // this.processFocusedCapturedUrl();
        void this.checkForUpdate();
    }

    private onBlur = () => {
        this.urlAtLastBlur = this.getCurrentAppUrl();
    };

    private getCurrentAppUrl(): string {
        return `${window.location.pathname}${window.location.search}`;
    }

    // TODO: Temporarily disabled, this is for PWA URL handling but is causing issues with normal navigation.
    // private processFocusedCapturedUrl(): void {
    //     const currentUrl = this.getCurrentAppUrl();
    //     if (currentUrl === this.urlAtLastBlur) {
    //         return;
    //     }
    //     this.logger.info('[PWA] Focus detected URL change: ' + currentUrl);
    //     this.urlAtLastBlur = currentUrl;
    //     void this.handleCapturedUrl(window.location.href, 'focus');
    // }

    // TODO: Temporarily disabled, this is for PWA URL handling but is causing issues with normal navigation.
    // private serviceWorkerMessageHandler = (event: MessageEvent) => {
    //     const data = event.data as { type?: string; url?: string } | undefined;
    //     if (data?.type !== 'NAVIGATE' || !data.url) {
    //         return;
    //     }
    //     this.logger.info('[PWA] Received NAVIGATE message from service worker: ' + data.url);
    //     this.urlAtLastBlur = this.getCurrentAppUrl();
    //     void this.handleCapturedUrl(data.url, 'service-worker');
    // };

    // TODO: Temporarily disabled, this is for PWA URL handling but is causing issues with normal navigation.
    // private historyNavigationHandler = () => {
    //     this.logger.info('[PWA] History navigation detected, evaluating URL');
    //     void this.handleCapturedUrl(window.location.href, 'history');
    // };

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

    private normalizeProtocolLinkPayload(value: string): string {
        const decoded = (() => {
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        })();

        // URLSearchParams decodes '+' as space. Recover our custom scheme if needed.
        if (decoded.startsWith('web mekbay://')) {
            return 'web+mekbay://' + decoded.slice('web mekbay://'.length);
        }

        if (decoded.startsWith('web mekbay:')) {
            return 'web+mekbay:' + decoded.slice('web mekbay:'.length);
        }

        return decoded;
    }

    private startPeriodicUpdateChecks() {
        this.stopPeriodicUpdateChecks();
        const scheduleNext = () => {
            this.updateCheckTimeoutId = window.setTimeout(async () => {
                await this.checkForUpdate(true);
                scheduleNext();
            }, this.updateCheckInterval);
        };
        scheduleNext();
    }

    private stopPeriodicUpdateChecks() {
        if (this.updateCheckTimeoutId !== null) {
            window.clearTimeout(this.updateCheckTimeoutId);
            this.updateCheckTimeoutId = null;
        }
    }

    private getLatestServiceWorkerHash(event: { latestVersion?: { hash?: string } }): string | null {
        const hash = event.latestVersion?.hash?.trim();
        return hash ? hash : null;
    }

    private getRecordedUpdateReloadHash(): string | null {
        try {
            const hash = localStorage.getItem(SW_UPDATE_RELOAD_HASH_STORAGE_KEY)?.trim();
            return hash ? hash : null;
        } catch {
            return null;
        }
    }

    private recordUpdateReloadHash(hash: string | null): void {
        if (!hash) {
            return;
        }

        try {
            localStorage.setItem(SW_UPDATE_RELOAD_HASH_STORAGE_KEY, hash);
        } catch {
            // Best effort only; startup must continue even if storage is unavailable.
        }
    }

    private clearRecordedUpdateReloadHash(): void {
        try {
            localStorage.removeItem(SW_UPDATE_RELOAD_HASH_STORAGE_KEY);
        } catch {
            // Best effort only; startup must continue even if storage is unavailable.
        }
    }

    private handleReadyServiceWorkerUpdate(event: { latestVersion?: { hash?: string } }): void {
        const latestHash = this.getLatestServiceWorkerHash(event);
        const recordedHash = this.getRecordedUpdateReloadHash();
        const shouldSuppressAutoReload = !!latestHash && latestHash === recordedHash;

        if (latestHash && recordedHash && latestHash !== recordedHash) {
            this.clearRecordedUpdateReloadHash();
        }

        this.pendingUpdateHash = latestHash;
        this.updateAutoReloadEnabled.set(!!latestHash && !shouldSuppressAutoReload);

        if (shouldSuppressAutoReload) {
            this.logger.warn(`Service worker update ${latestHash} is still pending after a previous reload attempt; suppressing automatic reload.`);
        } else {
            this.logger.info('Service worker update is ready');
        }

        this.updateAvailable.set(true);
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
        if (target instanceof Element && target.closest('[data-allow-native-context-menu="true"]')) {
            return;
        }

        event.preventDefault();
    };

    private async checkForUpdate(force = false) {
        if (!this.swUpdate.isEnabled) return;
        const now = Date.now();
        // Prevent too frequent checks
        if (!force && now - this.lastUpdateCheck < (this.updateCheckInterval / 4)) {
            return;
        }
        this.logger.info('Checking for updates...');
        this.lastUpdateCheck = now;

        try {
            if (await this.swUpdate.checkForUpdate()) {
                this.logger.info('Update available');
                this.updateAvailable.set(true);
                if (!this.pendingUpdateHash) {
                    this.updateAutoReloadEnabled.set(false);
                }
            }
        } catch (err) {
            this.logger.error('Error checking for updates:' + err);
        }
    }

    /**
     * Handle a URL captured by the service worker (e.g. from a link click
     * when the PWA is installed). Parses the URL and updates the app state
     * without a full navigation, applying smart context-aware logic:
     *
     * - shareUnit: Opens the unit details dialog directly.
     * - Search params (q, filters, sort, etc.):
     *   A) No loaded forces → apply search params and switch game system.
     *   B) Forces loaded + matching gs → apply search params.
     *   B) Forces loaded + different gs → warn, offer to unload forces.
     * - Force params (instance=, units=):
     *   A) No loaded forces → load the force directly.
     *   B) Forces loaded → offer to LOAD (replace), ADD (friendly/enemy), or DISMISS.
     */
    private async handleCapturedUrl(url: string, source: 'focus' | 'service-worker' | 'history' | 'protocol' = 'focus'): Promise<void> {
        this.logger.info(`[PWA] Handling captured URL from ${source}: ${url}`);
        let parsed: URL;
        try {
            parsed = new URL(url, window.location.origin);
        } catch {
            this.logger.error('[PWA] Failed to parse captured URL: ' + url);
            return;
        }

        if (parsed.origin !== window.location.origin) {
            this.logger.warn('[PWA] Ignoring captured URL from different origin: ' + parsed.origin);
            return;
        }

        if (this.shouldSkipDuplicateCapturedUrl(parsed)) {
            return;
        }

        const params = parsed.searchParams;

        const encodedProtocolLink = params.get('protocolLink');
        if (encodedProtocolLink) {
            const decodedProtocolLink = this.normalizeProtocolLinkPayload(encodedProtocolLink);

            let protocolUrl: URL;
            try {
                protocolUrl = new URL(decodedProtocolLink);
            } catch {
                this.logger.error('[PWA] Failed to parse protocolLink payload: ' + decodedProtocolLink);
                return;
            }

            if (protocolUrl.protocol !== 'web+mekbay:') {
                this.logger.warn('[PWA] Ignoring unsupported protocol payload: ' + protocolUrl.protocol);
                return;
            }

            const translatedParams = protocolUrl.searchParams.toString();
            const translatedUrl = `${window.location.origin}${window.location.pathname}${translatedParams ? `?${translatedParams}` : ''}`;
            this.logger.info('[PWA] Translated protocol link to app URL: ' + translatedUrl);
            await this.handleCapturedUrl(translatedUrl, 'protocol');
            return;
        }

        // Update browser URL bar (no reload)
        window.history.replaceState(null, '', parsed.pathname + parsed.search);

        // ── shareUnit: just show the dialog ──────────────────────────────
        const sharedUnitName = params.get('shareUnit');
        if (sharedUnitName) {
            const tab = params.get('tab') ?? undefined;
            const unit = this.dataService.getUnitByName(sharedUnitName);
            if (unit) {
                this.showSingleUnitDetails(unit, tab);
            } else {
                this.toastService.showToast(`Unit "${sharedUnitName}" not found.`, 'error');
            }
            return;
        }

        const hasForceParams = params.has('instance') || params.has('units');
        const hasSearchParams = params.has('q') || params.has('filters') || params.has('sort');
        const requestedGs = (params.get('gs') as GameSystem) ?? null;
        const hasForces = this.forceBuilderService.hasForces();

        // ── Force params (instance= / units=) ───────────────────────────
        if (hasForceParams) {
            if (!hasForces) {
                // A) No loaded forces → load directly
                await this.forceBuilderService.loadForceFromUrlParams(params, 'replace');
            } else {
                // B) Forces loaded → ask the user
                const choice = await this.dialogService.choose<'load' | 'add-friendly' | 'add-enemy' | 'dismiss'>(
                    'Incoming Force',
                    'A link with a force was opened. You already have forces loaded. What would you like to do?',
                    [
                        { label: 'LOAD (REPLACE)', value: 'load', class: 'danger' },
                        { label: 'ADD AS FRIENDLY', value: 'add-friendly' },
                        { label: 'ADD AS OPPOSING', value: 'add-enemy' },
                        { label: 'DISMISS', value: 'dismiss' },
                    ],
                    'dismiss'
                );

                switch (choice) {
                    case 'load':
                        await this.forceBuilderService.loadForceFromUrlParams(params, 'replace');
                        break;
                    case 'add-friendly':
                        await this.forceBuilderService.loadForceFromUrlParams(params, 'add', 'friendly');
                        break;
                    case 'add-enemy':
                        await this.forceBuilderService.loadForceFromUrlParams(params, 'add', 'enemy');
                        break;
                    case 'dismiss':
                        break;
                }
            }

            // Also apply any search params that came along with the force URL
            if (hasSearchParams) {
                this.unitSearchFiltersService.applySearchParamsFromUrl(params, { expandView: false });
            }
            // Switch game system if specified
            if (requestedGs) {
                this.gameService.setOverride(requestedGs);
            }
            return;
        }

        // ── Search params only (no force) ────────────────────────────────
        if (hasSearchParams) {
            if (!hasForces) {
                // A) No loaded forces → apply directly
                this.unitSearchFiltersService.applySearchParamsFromUrl(params);
                if (requestedGs) {
                    this.gameService.setOverride(requestedGs);
                }
            } else {
                // B) Forces loaded: check if gs matches
                const currentGs = this.gameService.currentGameSystem();
                const gsConflict = requestedGs && requestedGs !== currentGs;

                if (!gsConflict) {
                    // Same game system or no gs specified → apply search params
                    this.unitSearchFiltersService.applySearchParamsFromUrl(params);
                } else {
                    // Different game system → warn
                    const accepted = await this.dialogService.requestConfirmation(
                        `This link uses ${requestedGs === GameSystem.ALPHA_STRIKE ? 'Alpha Strike' : 'Classic BattleTech'}, ` +
                        `but you currently have forces loaded in ${currentGs === GameSystem.ALPHA_STRIKE ? 'Alpha Strike' : 'Classic BattleTech'}. ` +
                        `To switch, all loaded forces will be removed.\n\nContinue?`,
                        'Game System Conflict',
                        'danger'
                    );
                    if (accepted) {
                        await this.forceBuilderService.clear();
                        this.unitSearchFiltersService.applySearchParamsFromUrl(params);
                        this.gameService.setOverride(requestedGs);
                    }
                    // If declined, do nothing: keep current state
                }
            }
            return;
        }

        // ── No recognized params: just update the URL bar (already done) ──
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
        const loadedForces = this.forceBuilderService.loadedForces();
        const hasUnsavedForce = loadedForces.some(forceSlot => forceSlot.force.units().length > 0 && !forceSlot.force.instanceId());
        if (hasUnsavedForce) {
            // We have forces with units and without an instanceId? This is not yet saved. Warn the user before leaving.
            event.preventDefault();
            return 'You have unsaved changes in your force. Are you sure you want to leave?';
        }
        return undefined;
    };


    async reloadForUpdate(): Promise<void> {
        this.removeBeforeUnloadHandler();

        if (this.swUpdate.isEnabled) {
            this.recordUpdateReloadHash(this.pendingUpdateHash);
            try {
                const activated = await this.swUpdate.activateUpdate();
                if (activated) {
                    this.logger.info('Activated service worker update; reloading app.');
                } else {
                    this.logger.warn('Service worker activation returned false; reloading app anyway.');
                }
            } catch (err) {
                this.logger.error('Error activating service worker update: ' + err);
            }
        }

        this.performPageReload();
    }

    private performPageReload(): void {
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

    showNextDialog(): void {
        this.dialogService.showNextDialog();
    }

    showLoadForceDialog(): void {
        this.forceBuilderService.showLoadForceDialog();
    }

    showForceGeneratorDialog(): void {
        void this.forceBuilderService.showForceGeneratorDialog();
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