// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { OptionsService } from '../../services/options.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DialogRef } from '@angular/cdk/dialog';
import { DbService } from '../../services/db.service';
import { UserStateService } from '../../services/userState.service';
import { DialogsService } from '../../services/dialogs.service';
import { isIOS } from '../../utils/platform.util';
import { LoggerService } from '../../services/logger.service';
import { GameService } from '../../services/game.service';
import type { GameSystem } from '../../models/common.model';
import type {
    AutomationMode,
    AvailabilitySource,
    CBTAutomationKey,
    CBTOptionalRules,
    ForceViewerBVPVDisplay,
    RecordSheetDoubleTapZoomResetMode,
} from '../../models/options.model';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { DataService } from '../../services/data.service';
import { PublicTagsService } from '../../services/public-tags.service';
import { TagsService } from '../../services/tags.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { AccountAuthService } from '../../services/account-auth.service';
import { OAuthProviderPickerDialogComponent, type OAuthProviderPickerDialogResult } from '../oauth-provider-picker-dialog/oauth-provider-picker-dialog.component';
import type { AvailableAuthProvider, LinkedOAuthProvider, OAuthProvider } from '../../models/account-auth.model';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { naturalCompare } from '../../utils/sort.util';
import { AppUpdateService } from '../../services/app-update.service';
import { CatalogStorage } from '../../services/catalogs/catalog-storage.service';
import { deleteUnitCatalogDatabase } from '../../services/unit-catalog/unit-catalog-database';
import { DisplayNameService } from '../../services/display-name.service';

type OptionsSectionId = 'General' | 'Search' | 'Account' | 'Tags' | 'Classic BattleTech' | 'Alpha Strike' | 'Advanced' | 'Logs';

interface OptionsViewDefinition {
    id: OptionsSectionId;
    title: string;
    description?: string;
    parentId?: OptionsSectionId;
}

interface CBTAutomationOptionDefinition {
    readonly key: CBTAutomationKey;
    readonly label: string;
    readonly description: string;
}

const WIDE_LAYOUT_QUERY = '(min-width: 760px) and (min-height: 560px)';

const OPTIONS_VIEW_DEFINITIONS: readonly OptionsViewDefinition[] = [
    {
        id: 'General',
        title: 'General',
        description: 'Default game system, display preferences, and printing behavior.'
    },
    {
        id: 'Account',
        title: 'Account',
        description: 'OAuth providers, sign-in recovery, and account identity details.'
    },
    {
        id: 'Search',
        title: 'Search',
        description: 'Availability data, rarity matching, filter behavior, and expanded search layout.'
    },
    {
        id: 'Tags',
        title: 'Tags',
        description: 'Share your tags, copy public links, and manage subscriptions.'
    },
    {
        id: 'Classic BattleTech',
        title: 'Classic BattleTech',
        description: 'Rules, Record sheet appearance, automation, and navigation.'
    },
    {
        id: 'Alpha Strike',
        title: 'Alpha Strike',
        description: 'Card appearance, Alpha Strike rules automation, and printing behavior.'
    },
    {
        id: 'Advanced',
        title: 'Advanced',
        description: 'Input behavior, cached data, local storage, and maintenance actions.'
    },
    {
        id: 'Logs',
        title: 'Logs',
        description: 'Recent in-app log messages for diagnostics and troubleshooting.'
    },
];

const OPTIONS_VIEW_DEFINITIONS_BY_ID = new Map<OptionsSectionId, OptionsViewDefinition>(
    OPTIONS_VIEW_DEFINITIONS.map(view => [view.id, view])
);

const TOP_LEVEL_OPTIONS_VIEWS = OPTIONS_VIEW_DEFINITIONS.filter(view => !view.parentId);
const FORCE_GEN_FAILURE_SEARCH_WINDOW_MIN_MS = 300;
const FORCE_GEN_FAILURE_SEARCH_WINDOW_MAX_MS = 10_000;
const FORCE_GEN_FAILURE_SEARCH_WINDOW_STEP_MS = 100;
const CBT_AUTOMATION_MODES: ReadonlyArray<{ readonly value: AutomationMode; readonly label: string }> = [
    { value: 'yes', label: 'Yes' },
    { value: 'ask', label: 'Ask' },
    { value: 'no', label: 'No' },
];
const CBT_AUTOMATION_OPTIONS: readonly CBTAutomationOptionDefinition[] = [
    {
        key: 'pilotSkillCheck',
        label: 'Piloting skill checks',
        description: 'Resolve end-of-phase Piloting Skill Rolls. "No" keeps warnings available but skips resolution when the phase closes.',
    },
    {
        key: 'heatAndDissipationResolution',
        label: 'Heat and dissipation',
        description: 'Calculate and apply heat and cooling at end of turn.',
    },
    {
        key: 'heatEffectsCheck',
        label: 'Heat effects',
        description: 'Resolve shutdown, ammunition explosion, life support, and aerospace heat checks after end-turn heat is applied.',
    },
    {
        key: 'pilotHitsAndConsciousnessCheck',
        label: 'Pilot hits and consciousness',
        description: 'Apply pilot injuries, then resolve consciousness and recovery rolls.',
    },
    {
        key: 'internalExplosionsCheck',
        label: 'Internal explosions',
        description: 'Resolve effects caused by explosive equipment and ammunition.',
    },
    {
        key: 'criticalHitChanceCheck',
        label: 'Critical hit chance',
        description: 'Resolve checks that can cause critical hits.',
    },
    {
        key: 'breachAndFloodCheck',
        label: 'Breach and flood',
        description: 'Resolve armor breaches and flooding effects.',
    },
    {
        key: 'fallingCheck',
        label: 'Falling',
        description: 'Resolve fall orientation, hit locations, and damage before the seatbelt check.',
    },
];


@Component({
    selector: 'options-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, RangeSliderComponent],
    templateUrl: './options-dialog.component.html',
    styleUrls: ['./options-dialog.component.scss']
})
export class OptionsDialogComponent {
    logger = inject(LoggerService)
    optionsService = inject(OptionsService);
    gameSystem = inject(GameService);
    dbService = inject(DbService);
    private readonly catalogStorage = inject(CatalogStorage);
    dialogRef = inject(DialogRef<OptionsDialogComponent>);
    userStateService = inject(UserStateService);
    dialogsService = inject(DialogsService);
    spriteStorageService = inject(SpriteStorageService);
    dataService = inject(DataService);
    publicTagsService = inject(PublicTagsService);
    tagsService = inject(TagsService);
    taggingService = inject(TaggingService);
    toastService = inject(ToastService);
    accountAuthService = inject(AccountAuthService);
    appUpdateService = inject(AppUpdateService);
    displayNameService = inject(DisplayNameService);
    destroyRef = inject(DestroyRef);
    isIOS = isIOS();
    modalClass = 'wide options-dialog-modal';
    topLevelViews = TOP_LEVEL_OPTIONS_VIEWS;
    activeTab = signal<OptionsSectionId>('General');
    navigationStack = signal<OptionsSectionId[]>([]);
    isWideLayout = signal(typeof window !== 'undefined' ? window.matchMedia(WIDE_LAYOUT_QUERY).matches : true);
    canGoBack = computed(() => this.navigationStack().length > 0);
    isAtRoot = computed(() => !this.canGoBack());
    currentViewId = computed<OptionsSectionId>(() => this.navigationStack().at(-1) ?? this.activeTab());
    currentViewDefinition = computed(() => this.getViewDefinition(this.currentViewId()));
    currentViewDescription = computed(() => this.currentViewDefinition().description);
    mobileHeaderTitle = computed(() => this.canGoBack() ? this.currentViewDefinition().title : 'Options');
    forceGenFailureSearchWindowMinMs = FORCE_GEN_FAILURE_SEARCH_WINDOW_MIN_MS;
    forceGenFailureSearchWindowMaxMs = FORCE_GEN_FAILURE_SEARCH_WINDOW_MAX_MS;
    forceGenFailureSearchWindowStepMs = FORCE_GEN_FAILURE_SEARCH_WINDOW_STEP_MS;
    cbtAutomationModes = CBT_AUTOMATION_MODES;
    cbtAutomationOptions = CBT_AUTOMATION_OPTIONS;
    forceGenFailureSearchWindowMs = computed(() => this.normalizeForceGenFailureSearchWindowMs(this.optionsService.options().forceGenerator.failureSearchWindowMs));

    uuidInput = viewChild<ElementRef<HTMLInputElement>>('uuidInput');
    subscriptionInput = viewChild<ElementRef<HTMLInputElement>>('subscriptionInput');
    userUuid = computed(() => this.userStateService.uuid() || '');
    userPublicId = computed(() => this.userStateService.publicId() || 'Not registered');
    userDisplayName = computed(() => this.userStateService.displayName() || '');
    showUserUuid = signal(false);
    displayNameError = signal('');
    displayNameSaving = signal(false);
    displayNameGenerating = signal(false);
    private displayNameSaveVersion = 0;
    subscribedTags = computed(() => {
        this.publicTagsService.version(); // depend on version for reactivity
        return this.publicTagsService.getSubscribedTags();
    });
    userOwnTags = computed(() => {
        this.tagsService.version(); // depend on version for reactivity
        const nameTags = this.tagsService.getNameTags();
        const chassisTags = this.tagsService.getChassisTags();
        const allTags = new Set([...Object.keys(nameTags), ...Object.keys(chassisTags)]);
        return Array.from(allTags).sort(naturalCompare);
    });
    showSubscriptionInput = signal(false);
    subscriptionError = signal('');
    userUuidError = '';
    canvasMemorySize = signal(0);
    unitIconsCount = signal(0);
    unitsCount = computed(() => this.dataService.getUnits().length);
    equipmentCount = computed(() => this.dataService.getEquipmentRegistry().size);

    /** Subscriber counts for own tags: tagId (lowercase) -> count */
    tagSubscriberCounts = signal<Record<string, number>>({});
    /** Whether subscriber counts are loading */
    subscriberCountsLoading = signal(false);
    availableAuthProviders = computed<AvailableAuthProvider[]>(() => {
        const providers = this.userStateService.availableAuthProviders();
        if (providers.length > 0) {
            return providers;
        }

        return [
            { provider: 'google', label: 'Google', enabled: false },
            { provider: 'apple', label: 'Apple', enabled: false },
            { provider: 'discord', label: 'Discord', enabled: false },
        ];
    });
    linkedOAuthProviders = this.userStateService.oauthProviders;
    userHasOAuth = this.userStateService.hasOAuth;
    oauthActionInFlight = this.accountAuthService.authInFlight;
    logoutInFlight = signal(false);
    enabledAuthProviders = computed<AvailableAuthProvider[]>(() => this.availableAuthProviders().filter(provider => provider.enabled));
    linkableAuthProviders = computed<AvailableAuthProvider[]>(() => this.availableAuthProviders().filter(provider => !this.isProviderLinked(provider.provider)));
    hasEnabledAuthProviders = computed(() => this.enabledAuthProviders().length > 0);

    constructor() {
        this.setupLayoutModeTracking();
        this.updateCanvasMemorySize();
        this.updateUnitIconsCount();
        this.loadTagSubscriberCounts();
    }

    private setupLayoutModeTracking(): void {
        if (typeof window === 'undefined') {
            return;
        }

        const mediaQuery = window.matchMedia(WIDE_LAYOUT_QUERY);
        const updateLayout = (matches: boolean) => this.isWideLayout.set(matches);
        updateLayout(mediaQuery.matches);

        const onChange = (event: MediaQueryListEvent) => updateLayout(event.matches);
        mediaQuery.addEventListener('change', onChange);
        this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onChange));
    }

    private getViewDefinition(viewId: OptionsSectionId): OptionsViewDefinition {
        return OPTIONS_VIEW_DEFINITIONS_BY_ID.get(viewId) ?? OPTIONS_VIEW_DEFINITIONS_BY_ID.get('General')!;
    }

    private buildViewPath(viewId: OptionsSectionId): OptionsSectionId[] {
        const path: OptionsSectionId[] = [];
        let currentViewId: OptionsSectionId | undefined = viewId;

        while (currentViewId) {
            path.unshift(currentViewId);
            currentViewId = this.getViewDefinition(currentViewId).parentId;
        }

        return path;
    }

    private getTopLevelSectionId(viewId: OptionsSectionId): OptionsSectionId {
        let currentView = this.getViewDefinition(viewId);

        while (currentView.parentId) {
            currentView = this.getViewDefinition(currentView.parentId);
        }

        return currentView.id;
    }

    isSectionActive(sectionId: OptionsSectionId): boolean {
        return this.getTopLevelSectionId(this.currentViewId()) === sectionId;
    }

    selectDesktopSection(sectionId: OptionsSectionId): void {
        this.activeTab.set(sectionId);
        this.navigationStack.set([]);
    }

    openMobileSection(sectionId: OptionsSectionId): void {
        this.openView(sectionId);
    }

    openView(viewId: OptionsSectionId): void {
        this.activeTab.set(this.getTopLevelSectionId(viewId));
        this.navigationStack.set(this.buildViewPath(viewId));
    }

    pushView(viewId: OptionsSectionId): void {
        this.openView(viewId);
    }

    onMobileBack(): void {
        const stack = this.navigationStack();
        if (stack.length === 0) {
            this.onClose();
            return;
        }

        const nextStack = stack.slice(0, -1);
        this.navigationStack.set(nextStack);

        const nextViewId = nextStack.at(-1);
        if (nextViewId) {
            this.activeTab.set(this.getTopLevelSectionId(nextViewId));
        }
    }

    /**
     * Load subscriber counts for the user's own tags.
     * Uses a flag to prevent using results if the dialog is closed before completion.
     */
    private loadTagSubscriberCounts(): void {
        let cancelled = false;
        this.destroyRef.onDestroy(() => { cancelled = true; });

        this.subscriberCountsLoading.set(true);
        this.publicTagsService.getOwnTagSubscriberCounts().then(counts => {
            if (cancelled) return;
            if (counts) {
                this.tagSubscriberCounts.set(counts);
            }
            this.subscriberCountsLoading.set(false);
        }).catch(() => {
            if (cancelled) return;
            this.subscriberCountsLoading.set(false);
        });
    }

    /**
     * Get subscriber count for a specific tag.
     * @param tagName The tag name (display name, not necessarily lowercase)
     * @returns Subscriber count, or 0 if not found
     */
    getSubscriberCount(tagName: string): number {
        return this.tagSubscriberCounts()[tagName.toLowerCase()] || 0;
    }

    updateCanvasMemorySize() {
        this.dbService.getCanvasStoreSize().then(size => {
            this.canvasMemorySize.set(size);
        });
    }

    async updateUnitIconsCount() {
        const count = await this.spriteStorageService.getIconCount();
        this.unitIconsCount.set(count);
    }

    formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    onClose() {
        this.dialogRef.close();
    }

    restartToUpdate(): void {
        void this.appUpdateService.restartForUpdate();
    }

    onGameSystemChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as GameSystem;
        this.optionsService.setOption('gameSystem', value);
    }

    async onAvailabilitySourceChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as AvailabilitySource;

        if (value === 'megamek' && this.dataService.isDataReady()) {
            const ready = await this.dataService.ensureMegaMekAvailabilityCatalogInitialized();
            if (!ready) {
                this.toastService.showToast('MegaMek availability data could not be loaded.', 'error');
                return;
            }
        }

        this.optionsService.setOption('availabilitySource', value);
    }

    onMegaMekAvailabilityFiltersUseAllScopedOptionsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('megaMekAvailabilityFiltersUseAllScopedOptions', value);
    }

    onColorSchemeChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'default' | 'night';
        this.optionsService.setOption('colorScheme', value);
    }

    async onCBTRulesChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const value = select.value as 'core-2026' | 'total-warfare';
        const currentValue = this.optionsService.options().CBTRules;
        const confirmed = await this.dialogsService.requestConfirmation(
            'Changing the rules system will reload the application. Any uncommitted changes may be lost.',
            'Change Rules System?',
            'warning'
        );
        if (!confirmed) {
            select.value = currentValue;
            return;
        }
        await this.optionsService.setOption('CBTRules', value);
        window.location.reload();
    }

    onRecordSheetCenterPanelContentChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'fluffImage' | 'clusterTable';
        this.optionsService.setOption('printAllOptions', {
            ...this.optionsService.options().printAllOptions,
            recordSheetCenterPanelContent: value,
        });
    }

    onRecordSheetDoubleTapZoomResetChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as RecordSheetDoubleTapZoomResetMode;
        this.optionsService.setOption('recordSheetDoubleTapZoomReset', value);
    }

    onSyncZoomBetweenSheetsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('syncZoomBetweenSheets', value);
    }

    onAllowMultipleActiveSheetsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('allowMultipleActiveSheets', value);
    }

    onPickerStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'radial' | 'linear';
        this.optionsService.setOption('pickerStyle', value);
    }

    onUnitDisplayNameChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'chassisModel' | 'alias' | 'both';
        this.optionsService.setOption('unitDisplayName', value);
    }

    onForceViewerBVPVDisplayChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as ForceViewerBVPVDisplay;
        this.optionsService.setOption('forceViewerBVPVDisplay', value);
    }

    onAutoConvertFiltersChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('automaticallyConvertFiltersToSemantic', value);
    }

    onunitSearchExpandedViewLayoutChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'panel-list-filters' | 'filters-list-panel';
        this.optionsService.setOption('unitSearchExpandedViewLayout', value);
    }

    onCanvasInputChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'all' | 'touch' | 'pen';
        this.optionsService.setOption('canvasInput', value);
    }

    onPerformanceModeChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('performanceMode', value);
    }

    onForceSyncConflictDialogChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('enableForceSyncConflictDialog', value);
    }

    onSwipeToNextSheetChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'vertical' | 'horizontal' | 'disabled';
        this.optionsService.setOption('swipeToNextSheet', value);
    }

    onTrackPhaseAndTurn(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('trackPhaseAndTurn', value);
    }

    onCbtAutomationModeChange(key: CBTAutomationKey, value: AutomationMode) {
        this.optionsService.setCbtAutomationMode(key, value);
    }

    onCBTOptionalRuleChange(key: keyof CBTOptionalRules, event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('CBTOptionalRules', {
            ...this.optionsService.options().CBTOptionalRules,
            [key]: value,
        });
    }

    onASUseHexChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUseHex', value);
    }

    onASUnifiedDamagePickerChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUnifiedDamagePicker', value);
    }

    onASUseAutomationsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUseAutomations', value);
    }

    onVehiclesCriticalHitTableChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'default' | 'scouringSands';
        this.optionsService.setOption('ASVehiclesCriticalHitTable', value);
    }

    onForceGenFailureSearchWindowMsChange(value: number) {
        const nextValue = this.normalizeForceGenFailureSearchWindowMs(value);
        this.optionsService.updateForceGeneratorOptions((options) => ({
            ...options,
            failureSearchWindowMs: nextValue,
        }));
    }

    private normalizeForceGenFailureSearchWindowMs(value: number): number {
        const numericValue = Number.isFinite(value) ? value : FORCE_GEN_FAILURE_SEARCH_WINDOW_MIN_MS;
        const clampedValue = Math.min(FORCE_GEN_FAILURE_SEARCH_WINDOW_MAX_MS, Math.max(FORCE_GEN_FAILURE_SEARCH_WINDOW_MIN_MS, numericValue));
        const snappedValue = Math.round(clampedValue / FORCE_GEN_FAILURE_SEARCH_WINDOW_STEP_MS) * FORCE_GEN_FAILURE_SEARCH_WINDOW_STEP_MS;

        return Math.min(FORCE_GEN_FAILURE_SEARCH_WINDOW_MAX_MS, Math.max(FORCE_GEN_FAILURE_SEARCH_WINDOW_MIN_MS, snappedValue));
    }

    selectAll(event: FocusEvent) {
        const input = event.target as HTMLInputElement;
        input.select();
    }

    toggleUserUuidVisibility() {
        this.showUserUuid.update(value => !value);
    }

    async onPurgeCanvas() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete all drawings? This action cannot be undone.',
            'Confirm Purge Drawings',
            'danger'
        );
        if (confirmed) {
            await this.dbService.clearCanvasStore();
            this.updateCanvasMemorySize();
        }
    }

    async onPurgeIcons() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete all stored unit icons? They will be re-downloaded as needed.',
            'Confirm Purge Unit Icons',
            'info'
        );
        if (confirmed) {
            await this.spriteStorageService.clearSpritesStore();
            await this.updateUnitIconsCount();
            await this.spriteStorageService.reinitialize();
            await this.updateUnitIconsCount();
        }
    }

    async onPurgeCatalogs() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete the downloaded catalogs? MekBay will keep your forces, tags, and other local user data, then reload and download fresh catalog data.',
            'Confirm Purge Catalogs',
            'info'
        );

        if (confirmed) {
            await Promise.all([
                this.dbService.clearCatalogCaches(),
                this.catalogStorage.clear(),
                deleteUnitCatalogDatabase(),
            ]);
            window.location.reload();
        }
    }

    async onUserUuidKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.userUuidError = '';
            this.resetUserUuidInput();
        }
    }

    private resetUserUuidInput() {
        const uuidInput = this.uuidInput();
        if (!uuidInput) return;
        this.userUuidError = '';
        const el = uuidInput.nativeElement;
        el.value = this.userUuid();
        el.blur();
    }

    async queueDisplayNameSave(input: HTMLInputElement): Promise<void> {
        const version = ++this.displayNameSaveVersion;
        this.displayNameSaving.set(true);
        this.displayNameError.set('');
        try {
            const savedName = await this.displayNameService.save(input.value);
            if (version === this.displayNameSaveVersion) input.value = savedName;
        } catch (error) {
            if (version === this.displayNameSaveVersion) {
                this.displayNameError.set(error instanceof Error
                    ? error.message
                    : 'Could not save the display name.');
            }
        } finally {
            if (version === this.displayNameSaveVersion) this.displayNameSaving.set(false);
        }
    }

    onDisplayNameKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            input.value = this.userDisplayName();
            this.displayNameError.set('');
            void this.queueDisplayNameSave(input);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
            void this.queueDisplayNameSave(input);
        }
    }

    async fillRandomDisplayName(input: HTMLInputElement): Promise<void> {
        if (this.displayNameGenerating()) return;
        this.displayNameGenerating.set(true);
        try {
            input.value = await this.displayNameService.generate();
            this.displayNameError.set('');
            await this.queueDisplayNameSave(input);
        } finally {
            this.displayNameGenerating.set(false);
        }
    }

    async onSetUuid(value: string) {
        if (this.userHasOAuth()) {
            this.userUuidError = 'User Identifier changes are disabled for OAuth-connected accounts.';
            this.resetUserUuidInput();
            return;
        }

        this.userUuidError = '';
        const trimmed = value.trim();
        if (trimmed === this.userUuid()) {
            // No change
            return;
        }
        if (trimmed.length === 0) {
            // Generate a new UUID if input is empty
            const confirmed = await this.dialogsService.requestConfirmation(
                'Are you sure you want to generate a new User Identifier? This will disconnect you from your cloud data. Your local data will remain intact.',
                'Confirm New Identifier', 'danger');
            if (!confirmed) {
                this.resetUserUuidInput();
                return;
            }
            await this.userStateService.createNewUUID();
            window.location.reload();
            return;
        }
        try {
            const confirmed = await this.dialogsService.requestConfirmation(
                'Are you sure you want to set a new User Identifier? This will disconnect you from your cloud data. Your local data will remain intact.',
                'Confirm New Identifier', 'danger');
            if (!confirmed) {
                this.resetUserUuidInput();
                return;
            }
            await this.userStateService.setUuid(trimmed);
            window.location.reload();
        } catch (e: any) {
            this.userUuidError = e?.message || 'An unknown error occurred.';
            return;
        }
    }

    async onLogout() {
        if (!this.userHasOAuth() || this.logoutInFlight() || this.oauthActionInFlight()) {
            return;
        }

        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to log out on this device? MekBay will remove the local account data stored in this browser, including forces, operations, organizations, tags, subscribed public tags, saved searches and drawings. Your linked OAuth providers will remain attached to your MekBay account. A fresh anonymous User Identifier will then be generated and the app will reload.',
            'Confirm Logout',
            'danger'
        );

        if (!confirmed) {
            return;
        }

        this.logoutInFlight.set(true);

        try {
            await this.dbService.clearLocalUserStores();
            await this.userStateService.createFreshSession();
            window.location.reload();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to log out.';
            this.logger.error(`Logout failed: ${message}`);
            this.toastService.showToast(message, 'error');
            this.logoutInFlight.set(false);
        }
    }

    async onUnsubscribePublicTag(publicId: string, tagName: string) {
        await this.publicTagsService.unsubscribeWithConfirmation(publicId, tagName);
    }

    onShowSubscriptionInput() {
        this.showSubscriptionInput.set(true);
        this.subscriptionError.set('');
        // Focus input after render
        setTimeout(() => {
            this.subscriptionInput()?.nativeElement.focus();
        }, 0);
    }

    onCancelSubscription() {
        this.showSubscriptionInput.set(false);
        this.subscriptionError.set('');
        const input = this.subscriptionInput();
        if (input) input.nativeElement.value = '';
    }

    async onSubscriptionKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.onCancelSubscription();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const input = this.subscriptionInput();
            if (input) {
                await this.onAddSubscription(input.nativeElement.value);
            }
        }
    }

    async onAddSubscription(value: string) {
        this.subscriptionError.set('');
        const trimmed = value.trim();
        
        if (!trimmed) {
            this.subscriptionError.set('Please enter a subscription in the format publicId:tagName');
            return;
        }

        // Parse publicId:tagName format
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) {
            this.subscriptionError.set('Invalid format. Use publicId:tagName (e.g., abc123:MyTag)');
            return;
        }

        const publicId = trimmed.substring(0, colonIndex).trim();
        const tagName = trimmed.substring(colonIndex + 1).trim();

        if (!publicId || !tagName) {
            this.subscriptionError.set('Both publicId and tagName are required');
            return;
        }

        // Check if trying to subscribe to own tags
        if (publicId === this.userPublicId()) {
            this.subscriptionError.set('You cannot subscribe to your own tags');
            return;
        }

        // Check if already subscribed
        if (this.publicTagsService.isTagSubscribed(publicId, tagName)) {
            this.subscriptionError.set('Already subscribed to this tag');
            return;
        }

        try {
            const result = await this.publicTagsService.subscribe(publicId, tagName);
            if (result.success) {
                this.showSubscriptionInput.set(false);
                const input = this.subscriptionInput();
                if (input) input.nativeElement.value = '';
            } else {
                // Show specific error from server if available
                if (result.error === 'User not found') {
                    this.subscriptionError.set('Invalid public ID. The user does not exist.');
                } else if (result.error === 'Tag not found') {
                    this.subscriptionError.set('Tag not found. The tag does not exist for this user.');
                } else if (result.error === 'Cannot subscribe to your own tags') {
                    this.subscriptionError.set('You cannot subscribe to your own tags');
                } else {
                    this.subscriptionError.set(result.error || 'Failed to subscribe. The tag may not exist or is not public.');
                }
            }
        } catch (e: any) {
            this.subscriptionError.set(e?.message || 'Failed to subscribe');
        }
    }

    async onCopyTagLink(tagName: string) {
        const publicId = this.userPublicId();
        if (publicId === 'Not registered') {
            this.toastService.showToast('You need to be registered to share tags', 'error');
            return;
        }
        const link = `${publicId}:${tagName}`;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(link);
            } else {
                // Fallback for older browsers (iOS < 13.4, older Firefox)
                const textArea = document.createElement('textarea');
                textArea.value = link;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            this.toastService.showToast(`Copied: ${link}`, 'success');
        } catch {
            this.toastService.showToast('Failed to copy to clipboard', 'error');
        }
    }

    async onDeleteTag(tagName: string) {
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to delete the tag "${tagName}"? This will remove the tag from all units.`,
            'Delete Tag',
            'danger'
        );
        if (!confirmed) return;

        await this.tagsService.deleteTag(tagName);
        this.toastService.showToast(`Tag "${tagName}" deleted`, 'success');
    }

    async onRenameTag(tagName: string) {
        await this.taggingService.renameTag(tagName);
    }

    isProviderLinked(provider: OAuthProvider): boolean {
        return this.linkedOAuthProviders().some(linkedProvider => linkedProvider.provider === provider);
    }

    getLinkedProvider(provider: OAuthProvider): LinkedOAuthProvider | undefined {
        return this.linkedOAuthProviders().find(linkedProvider => linkedProvider.provider === provider);
    }

    getProviderLabel(provider: OAuthProvider): string {
        return this.accountAuthService.getProviderLabel(provider);
    }

    isProviderEnabled(provider: OAuthProvider): boolean {
        return this.availableAuthProviders().some(availableProvider => availableProvider.provider === provider && availableProvider.enabled);
    }

    getProviderIdentity(provider: LinkedOAuthProvider): string {
        return provider.displayName || provider.email || `${this.getProviderLabel(provider.provider)} account`;
    }

    async showProviderSignInDialog(): Promise<void> {
        if (this.userHasOAuth()) {
            return;
        }

        const providers = this.enabledAuthProviders();
        if (providers.length === 0) {
            await this.dialogsService.showNotice(
                'Provider sign-in is not available yet because no OAuth providers are configured on this server.',
                'Provider Sign-In Unavailable'
            );
            return;
        }

        const ref = this.dialogsService.createDialog<OAuthProviderPickerDialogResult>(OAuthProviderPickerDialogComponent, {
            disableClose: true,
            data: {
                title: 'Sign In',
                message: 'Choose a provider to recover the MekBay UUID already linked to that account.',
                providers,
            }
        });
        const choice = (await firstValueFrom(ref.closed)) ?? 'dismiss';

        if (choice === 'dismiss') {
            return;
        }

        await this.accountAuthService.loginWithProvider(choice);
    }

    onLinkProvider(provider: OAuthProvider) {
        void this.accountAuthService.linkProvider(provider, false);
    }

    onReplaceProvider(provider: OAuthProvider) {
        void this.accountAuthService.linkProvider(provider, true);
    }

    onUnlinkProvider(provider: OAuthProvider) {
        void this.accountAuthService.unlinkProvider(provider);
    }
}
