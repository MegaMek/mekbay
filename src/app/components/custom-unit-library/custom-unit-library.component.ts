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

@Component({
    selector: 'custom-unit-library', changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <p>{{ owned() ? 'Your custom designs sync across your devices. Deleting a design removes it from your library on every device.' : 'Subscribed designs stay in your library and receive updates from their owners. Unsubscribe to remove a design from your library.' }}</p>
        <p>Saved forces include their own copies of custom designs. Library updates and deletions do not change those copies.</p>
        @if (owned()) { <p>{{ records().length }} / {{ ownedLimit }} custom units</p> }
        @if (sync.error()) { <p role="alert">{{ sync.error() }}</p> }
        <button class="bt-button" [disabled]="sync.syncing()" (click)="sync.sync()">{{ sync.syncing() ? 'Syncing…' : 'Sync now' }}</button>
        <ul class="custom-units">
        @for (record of records(); track record.uuid) {
            <li>
                <span>{{ name(record) }}</span>
                @if (owned()) { <span class="count">{{ sync.subscriberCounts().get(record.uuid) ?? '—' }} subscribers</span> }
                @if (sync.conflicts().has(record.uuid)) {
                    <span class="count">Conflicting edits</span>
                    <button class="bt-button" [disabled]="busy()" (click)="resolve(record)">Resolve conflict</button>
                } @else if (record.pending) { <span class="count">Waiting to sync</span> }
                <button class="bt-button" [class.danger]="owned()" [disabled]="busy()" (click)="remove(record)">{{ owned() ? 'Delete' : 'Unsubscribe' }}</button>
            </li>
        } @empty { <li>{{ owned() ? 'No custom units yet.' : 'You are not subscribed to any units.' }}</li> }
        </ul>`,
    styles: [`.custom-units { list-style:none; padding:0; } li { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #ffffff22; } li > span:first-child { flex:1; min-width:150px; } .count { opacity:.75; font-size:.85rem; } p { line-height:1.5; }`],
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
    constructor() { void this.sync.sync(); }
    name(record: SavedCustomUnit): string { const unit = this.data.getUnitByUuid(record.uuid); return unit ? this.names.name(unit) : 'Custom unit'; }
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
