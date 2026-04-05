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
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { DataService } from '../../services/data.service';
import { PublicTagsService } from '../../services/public-tags.service';
import { TagsService } from '../../services/tags.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { AccountAuthService } from '../../services/account-auth.service';
import { OAuthProviderPickerDialogComponent, type OAuthProviderPickerDialogResult } from '../oauth-provider-picker-dialog/oauth-provider-picker-dialog.component';
import type { AvailableAuthProvider, LinkedOAuthProvider, OAuthProvider } from '../../models/account-auth.model';

type OptionsSectionId = 'General' | 'Account' | 'Tags' | 'Sheets' | 'Alpha Strike' | 'Advanced' | 'Logs';
type OptionsViewId = OptionsSectionId;

interface OptionsViewDefinition {
    id: OptionsViewId;
    title: string;
    description?: string;
    parentId?: OptionsViewId;
}

const WIDE_LAYOUT_QUERY = '(min-width: 760px) and (min-height: 560px)';

const OPTIONS_VIEW_DEFINITIONS: readonly OptionsViewDefinition[] = [
    {
        id: 'General',
        title: 'General',
        description: 'Game system, search defaults, user identity, and general printing preferences.'
    },
    {
        id: 'Account',
        title: 'Account',
        description: 'OAuth providers, sign-in recovery, and account identity details.'
    },
    {
        id: 'Tags',
        title: 'Tags',
        description: 'Share your tags, copy public links, and manage subscriptions.'
    },
    {
        id: 'Sheets',
        title: 'Record Sheets',
        description: 'Record sheet appearance, quick actions, automation, and navigation.'
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

const OPTIONS_VIEW_DEFINITIONS_BY_ID = new Map<OptionsViewId, OptionsViewDefinition>(
    OPTIONS_VIEW_DEFINITIONS.map(view => [view.id, view])
);

const TOP_LEVEL_OPTIONS_VIEWS = OPTIONS_VIEW_DEFINITIONS.filter(view => !view.parentId);

/*
 * Author: Drake
 */
@Component({
    selector: 'options-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    templateUrl: './options-dialog.component.html',
    styleUrls: ['./options-dialog.component.css']
})
export class OptionsDialogComponent {
    logger = inject(LoggerService)
    optionsService = inject(OptionsService);
    gameSystem = inject(GameService);
    dbService = inject(DbService);
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
    destroyRef = inject(DestroyRef);
    isIOS = isIOS();
    modalClass = 'wide options-dialog-modal';
    topLevelViews = TOP_LEVEL_OPTIONS_VIEWS;
    activeTab = signal<OptionsSectionId>('General');
    navigationStack = signal<OptionsViewId[]>([]);
    isWideLayout = signal(typeof window !== 'undefined' ? window.matchMedia(WIDE_LAYOUT_QUERY).matches : true);
    canGoBack = computed(() => this.navigationStack().length > 0);
    isAtRoot = computed(() => !this.canGoBack());
    currentViewId = computed<OptionsViewId>(() => this.navigationStack().at(-1) ?? this.activeTab());
    currentViewDefinition = computed(() => this.getViewDefinition(this.currentViewId()));
    currentViewDescription = computed(() => this.currentViewDefinition().description);
    mobileHeaderTitle = computed(() => this.canGoBack() ? this.currentViewDefinition().title : 'Options');

    uuidInput = viewChild<ElementRef<HTMLInputElement>>('uuidInput');
    subscriptionInput = viewChild<ElementRef<HTMLInputElement>>('subscriptionInput');
    userUuid = computed(() => this.userStateService.uuid() || '');
    userPublicId = computed(() => this.userStateService.publicId() || 'Not registered');
    showUserUuid = signal(false);
    subscribedTags = computed(() => {
        this.publicTagsService.version(); // depend on version for reactivity
        return this.publicTagsService.getSubscribedTags();
    });
    userOwnTags = computed(() => {
        this.tagsService.version(); // depend on version for reactivity
        const nameTags = this.tagsService.getNameTags();
        const chassisTags = this.tagsService.getChassisTags();
        const allTags = new Set([...Object.keys(nameTags), ...Object.keys(chassisTags)]);
        return Array.from(allTags).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    });
    showSubscriptionInput = signal(false);
    subscriptionError = signal('');
    userUuidError = '';
    sheetCacheSize = signal(0);
    sheetCacheCount = signal(0);
    canvasMemorySize = signal(0);
    unitIconsCount = signal(0);
    unitsCount = computed(() => this.dataService.getUnits().length);
    equipmentCount = computed(() => Object.keys(this.dataService.getEquipments()).length);

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
    hasEnabledAuthProviders = computed(() => this.enabledAuthProviders().length > 0);

    constructor() {
        this.setupLayoutModeTracking();
        this.updateSheetCacheSize();
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

    private getViewDefinition(viewId: OptionsViewId): OptionsViewDefinition {
        return OPTIONS_VIEW_DEFINITIONS_BY_ID.get(viewId) ?? OPTIONS_VIEW_DEFINITIONS_BY_ID.get('General')!;
    }

    private buildViewPath(viewId: OptionsViewId): OptionsViewId[] {
        const path: OptionsViewId[] = [];
        let currentViewId: OptionsViewId | undefined = viewId;

        while (currentViewId) {
            path.unshift(currentViewId);
            currentViewId = this.getViewDefinition(currentViewId).parentId;
        }

        return path;
    }

    private getTopLevelSectionId(viewId: OptionsViewId): OptionsSectionId {
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

    openView(viewId: OptionsViewId): void {
        this.activeTab.set(this.getTopLevelSectionId(viewId));
        this.navigationStack.set(this.buildViewPath(viewId));
    }

    pushView(viewId: OptionsViewId): void {
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

    updateSheetCacheSize() {
        this.dbService.getSheetsStoreSize().then(({ memorySize, count }) => {
            this.sheetCacheSize.set(memorySize);
            this.sheetCacheCount.set(count);
        });
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

    onGameSystemChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as GameSystem;
        this.optionsService.setOption('gameSystem', value);
    }

    onSheetsColorChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'normal' | 'night';
        this.optionsService.setOption('sheetsColor', value);
    }

    onRecordSheetCenterPanelContentChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'fluffImage' | 'clusterTable';
        this.optionsService.setOption('recordSheetCenterPanelContent', value);
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

    onAutoConvertFiltersChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('automaticallyConvertFiltersToSemantic', value);
    }

    onQuickActionsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'enabled' | 'disabled';
        this.optionsService.setOption('quickActions', value);
    }

    onunitSearchExpandedViewLayoutChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'panel-list-filters' | 'filters-list-panel';
        this.optionsService.setOption('unitSearchExpandedViewLayout', value);
    }

    onCanvasInputChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'all' | 'touch' | 'pen';
        this.optionsService.setOption('canvasInput', value);
    }

    onSwipeToNextSheetChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'vertical' | 'horizontal' | 'disabled';
        this.optionsService.setOption('swipeToNextSheet', value);
    }

    onUseAutomationsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('useAutomations', value);
    }

    onASUseHexChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUseHex', value);
    }

    onASCardStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'colored' | 'monochrome';
        this.optionsService.setOption('ASCardStyle', value);
    }

    onASPrintPageBreakOnGroupsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASPrintPageBreakOnGroups', value);
    }

    onprintRosterSummaryChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('printRosterSummary', value);
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

    selectAll(event: FocusEvent) {
        const input = event.target as HTMLInputElement;
        input.select();
    }

    toggleUserUuidVisibility() {
        this.showUserUuid.update(value => !value);
    }

    async onPurgeCache() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete all cached record sheets? They will be redownloaded as needed.',
            'Confirm Purge Cache',
            'info'
        );
        if (confirmed) {
            await this.dbService.clearSheetsStore();
            this.updateSheetCacheSize();

            if ('caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map(key => window.caches.delete(key)));
            }

            window.location.reload();
        }
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

    getProviderLinkButtonLabel(provider: OAuthProvider): string {
        const action = this.isProviderLinked(provider) ? 'Replace' : 'Link';
        return `${action} ${this.getProviderLabel(provider)}`;
    }

    getProviderIdentity(provider: LinkedOAuthProvider): string {
        return provider.displayName || provider.email || `${this.getProviderLabel(provider.provider)} account`;
    }

    async showProviderSignInDialog(): Promise<void> {
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
        void this.accountAuthService.linkProvider(provider, this.isProviderLinked(provider));
    }

    onUnlinkProvider(provider: OAuthProvider) {
        if (this.linkedOAuthProviders().length <= 1) {
            this.toastService.showToast('At least one OAuth provider must remain linked once your account is connected.', 'error');
            return;
        }

        void this.accountAuthService.unlinkProvider(provider);
    }
}