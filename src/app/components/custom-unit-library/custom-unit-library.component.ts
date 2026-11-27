// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { DataService } from '../../services/data.service';
import { UnitNameService } from '../../services/unit-name.service';
import { DialogsService } from '../../services/dialogs.service';
import { ToastService } from '../../services/toast.service';
import type { SavedCustomUnit } from '../../models/custom-unit.model';
import { MAX_OWNED_CUSTOM_UNITS } from '../../models/custom-design-policy';
import { SubscriberCountComponent } from '../subscriber-count/subscriber-count.component';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';

@Component({
    selector: 'custom-unit-library', changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [SubscriberCountComponent],
    template: `
        <div class="library-header">
            <p class="library-notice">{{ owned() ? 'Designs and deletions sync across your devices.' : 'Subscribed designs receive owner updates. Unsubscribe to remove them from your library.' }} Copies in saved forces are kept unchanged.</p>
            <button class="bt-button" [disabled]="sync.syncing()" (click)="sync.sync()">{{ sync.syncing() ? 'Syncing…' : 'Sync now' }}</button>
        </div>
        @if (nearOwnedLimit()) { <p class="library-notice capacity-notice">{{ records().length.toLocaleString('en-US') }} / {{ ownedLimit }} custom units</p> }
        @if (sync.error()) { <p class="library-notice sync-notice" role="alert">{{ sync.error() }}</p> }
        <ul class="custom-units">
        @for (record of records(); track record.uuid) {
            <li>
                <span class="unit-name">{{ name(record) }}</span>
                @if (owned()) { <subscriber-count [count]="sync.subscriberCounts().get(record.uuid) ?? 0" /> }
                @if (sync.conflicts().has(record.uuid)) {
                    <span class="count">Conflicting edits</span>
                    <button class="bt-button" [disabled]="busy()" (click)="resolve(record)">Resolve conflict</button>
                } @else if (record.pending) { <span class="count">Waiting to sync</span> }
                <div class="unit-actions">
                    <button class="bt-button inspect-unit" [attr.aria-label]="'Inspect ' + name(record)" (click)="inspect(record)">Inspect</button>
                    <button class="bt-button" [class.danger]="owned()" [disabled]="busy()" (click)="remove(record)">{{ owned() ? 'Delete' : 'Unsubscribe' }}</button>
                </div>
            </li>
        } @empty { <li>{{ owned() ? 'No custom units yet.' : 'You are not subscribed to any units.' }}</li> }
        </ul>`,
    styles: `
        :host { display: block; }
        .library-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
        .library-header .library-notice { flex: 1; min-width: 200px; }
        .library-notice { margin: 0; color: var(--text-color-secondary); font-size: .8rem; line-height: 1.4; }
        .sync-notice, .capacity-notice { margin-top: 8px; }
        .capacity-notice { color: var(--bt-yellow); }
        .custom-units { list-style: none; margin: 12px 0 0; padding: 0; }
        li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; border-bottom: 1px solid #ffffff22; }
        .unit-name { flex: 1; min-width: 150px; overflow-wrap: anywhere; }
        .count { color: var(--text-color-secondary); font-size: .85rem; }
        .unit-actions { display: flex; gap: 8px; margin-left: auto; }
        .bt-button { padding: .3em .6em; font-size: .85rem; }
    `,
})
export class CustomUnitLibraryComponent {
    readonly owned = input(true);
    readonly ownedLimit = MAX_OWNED_CUSTOM_UNITS.toLocaleString('en-US');
    readonly sync = inject(CustomUnitSyncService);
    private readonly data = inject(DataService);
    private readonly names = inject(UnitNameService);
    private readonly dialogs = inject(DialogsService);
    private readonly toast = inject(ToastService);
    readonly busy = signal(false);
    readonly records = computed(() => this.sync.library.records().filter(r => this.owned() ? r.owned !== false : r.owned === false && r.subscribed));
    readonly nearOwnedLimit = computed(() => this.owned() && this.records().length >= MAX_OWNED_CUSTOM_UNITS * 0.9);
    constructor() { void this.sync.sync(); }
    name(record: SavedCustomUnit): string { const unit = this.data.getUnitByUuid(record.uuid); return unit ? this.names.name(unit) : 'Custom unit'; }
    inspect(record: SavedCustomUnit): void {
        const unit = this.data.getUnitByUuid(record.uuid);
        if (!unit) {
            this.toast.showToast('Unit details are not available yet. Try syncing your library.', 'info');
            return;
        }
        this.dialogs.createDialog(UnitDetailsDialogComponent, {
            data: { unitList: [unit], unitIndex: 0 } satisfies UnitDetailsDialogData,
        });
    }
    async resolve(record: SavedCustomUnit): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try {
            const choice = await this.dialogs.choose('Resolve conflicting edits',
                `The cloud version of ${this.name(record)} changed or was deleted on another device. Use that version, or first preserve your local changes as a separate custom design.`,
                [{ label: 'KEEP LOCAL AS A COPY', value: 'copy' }, { label: 'USE CLOUD VERSION', value: 'cloud', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' }], 'cancel');
            if (choice === 'cancel') return;
            await this.sync.resolveConflict(record, choice === 'copy');
            this.toast.showToast(choice === 'copy' ? 'Your local changes were saved as a new custom design.' : 'Your library now uses the cloud version.', 'info');
        } catch (error) { this.toast.showToast(error instanceof Error ? error.message : 'Could not resolve this conflict.', 'error'); }
        finally { this.busy.set(false); }
    }
    async remove(record: SavedCustomUnit): Promise<void> {
        if (this.busy()) return;
        if (this.owned() && !await this.dialogs.requestConfirmation(
            `Delete ${this.name(record)} from your custom unit library on all devices? Anyone subscribed will lose access. Copies included in saved forces are kept.`,
            'Delete custom unit', 'danger')) return;
        this.busy.set(true);
        try {
            if (this.owned()) { await this.sync.library.delete(record.uuid); await this.data.refreshCustomUnits(); }
            else await this.sync.unsubscribe(record.uuid);
        } catch (error) { this.toast.showToast(error instanceof Error ? error.message : 'Could not remove this unit.', 'error'); }
        finally { this.busy.set(false); }
    }
}
