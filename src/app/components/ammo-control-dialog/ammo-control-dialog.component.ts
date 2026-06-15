import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { HandlerContext } from '../../services/equipment-interaction-registry.service';
import type { AmmoControlEntry, AmmoControlGroup } from '../../utils/ammo-interaction.util';
import { changeAmmoEntryRemaining, changeAmmoGroupRemaining, getAmmoControlGroups, getAmmoEntryRemaining, getAmmoGroupRemaining, setAmmoEntry, setAmmoGroup } from '../../utils/ammo-interaction.util';

export interface AmmoControlDialogData {
    title: string;
    entries: AmmoControlEntry[];
    context: HandlerContext;
    readOnly?: boolean;
    getEntries?: () => AmmoControlEntry[];
}

@Component({
    selector: 'ammo-control-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog ammo-control-dialog">
        <h2 class="wide-dialog-title">{{ data.title }}</h2>
        <div class="wide-dialog-body">
            <div class="ammo-control-list" [class.read-only]="readOnly()">
                @for (group of groups(); track group.id) {
                    <div class="ammo-control-row" [class.destroyed-entry]="group.destroyed">
                        <div class="ammo-control-label" [class.expandable]="group.expandable">
                            @if (group.expandable) {
                                <button class="ammo-expand-button" type="button" (click)="toggleGroup(group)">
                                    <svg width="13px" height="13px" fill="currentColor" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" class="chevron" [class.collapsed]="!isExpanded(group)"><path d="M0 2l5 6 5-6z"></path></svg>
                                    <span class="ammo-name">{{ group.displayName }}
                                        <span class="ammo-location-badges">
                                        @for (location of group.locations; track location.loc) {
                                            <span class="ammo-location-badge" [class.exposed]="location.state === 'exposed'" [class.destroyed]="location.state === 'destroyed'">
                                                @if (location.quantity > 1) {
                                                    <span class="quantity">{{ location.quantity + 'x' }}</span>
                                                }
                                                {{ location.loc }}
                                            </span>
                                        }
                                        </span>
                                    </span>
                                </button>
                            } @else {
                                <div class="ammo-single-entry">
                                    <div class="chevron"></div>
                                    <span class="ammo-name">{{ group.displayName }}
                                        <span class="ammo-location-badges">
                                            @for (location of group.locations; track location.loc) {
                                                <span class="ammo-location-badge" [class.exposed]="location.state === 'exposed'" [class.destroyed]="location.state === 'destroyed'">
                                                    @if (location.quantity > 1) {
                                                        <span class="quantity">{{ location.quantity + 'x' }}</span>
                                                    }
                                                    {{ location.loc }}
                                                </span>
                                            }
                                        </span>
                                    </span>
                                </div>
                            }
                            <span class="ammo-count">{{ groupRemaining(group) }}/{{ group.totalAmmo }}</span>
                            @if (isExpanded(group)) {
                                <div class="ammo-bin-list">
                                    @for (entry of group.entries; track entry.id) {
                                        <div class="ammo-bin" [class.destroyed]="entry.destroyed">
                                            <button class="ammo-bin-name-wrapper" type="button" (click)="setAmmoBin(entry)" [disabled]="entry.destroyed || readOnly()">
                                                <span class="ammo-bin-name">{{ entry.displayBinName }}</span>
                                                <span class="ammo-location-badges">
                                                    <span class="ammo-location-badge" [class.destroyed]="entry.destroyed">
                                                        {{ entry.locationLabel }}
                                                    </span>
                                                </span>
                                            </button>
                                            @if (!entry.destroyed && !readOnly()) {
                                                <div class="ammo-bin-adjustments">
                                                    <button class="ammo-bin-adjust bt-button square-small" type="button" (click)="decrementBin(entry)" [disabled]="remaining(entry) <= 0">-1</button>
                                                    <button class="ammo-bin-adjust bt-button square-small" type="button" (click)="incrementBin(entry)" [disabled]="remaining(entry) >= entry.totalAmmo">+1</button>
                                                </div>
                                            } @else {
                                                <span class="ammo-bin-adjustments" aria-hidden="true"></span>
                                            }
                                            <span class="ammo-count">{{ remaining(entry) }}/{{ entry.totalAmmo }}</span>
                                        </div>
                                    }
                                </div>
                            }
                        </div>
                        @if (!readOnly()) {
                            <div class="ammo-control-actions">
                                @if (!group.destroyed) {
                                    <button class="bt-button square-small" type="button" (click)="decrement(group)" [disabled]="groupRemaining(group) <= 0">-1</button>
                                    <button class="bt-button square-small" type="button" (click)="increment(group)" [disabled]="groupRemaining(group) >= group.totalAmmo">+1</button>
                                    <button class="bt-button" type="button" (click)="setAmmo(group)">SET AMMO</button>
                                }
                            </div>
                        }
                    </div>
                }
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button class="bt-button" type="button" (click)="close()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .ammo-control-list {
            display: grid;
        }

        .ammo-control-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 4px 12px;
            align-items: start;
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .ammo-control-list.read-only .ammo-control-row {
            grid-template-columns: minmax(0, 1fr);
        }

        .ammo-control-row:last-child {
            border-bottom: 0;
        }

        .ammo-control-row.destroyed-entry .ammo-name,
        .ammo-bin.destroyed {
            color: var(--damage-color);
        }

        .ammo-control-row.destroyed-entry {
            color: var(--damage-color);
        }

        .ammo-control-label {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 0px 8px;
            align-items: baseline;
            min-width: 0;
        }

        .ammo-single-entry,
        .ammo-expand-button {
            display: inline-flex;
            align-items: flex-start;
            justify-content: flex-start;
            gap: 4px;
            min-width: 0;
            min-height: 32px;
            padding: calc((32px - 1.3em) / 2) 0 0 0;
            box-sizing: border-box;
            border: 0;
            background: transparent;
            font: inherit;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .ammo-expand-button {
            cursor: pointer;
        }

        .chevron {
            color: var(--text-color-secondary);
            transition: transform 0.15s ease;
            flex-shrink: 0;
            width: 13px;
            height: 13px;
            margin-top: calc((1.3em - 13px) / 2);
        }

        .chevron.collapsed {
            transform: rotate(-90deg);
        }

        .ammo-name {
            color: var(--text-color);
            text-align: left;
            line-height: 1.3;
        }

        .ammo-location-badges {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 3px;
            align-items: center;
            min-width: 0;
            position: relative;
            top: -2px;
        }

        .ammo-location-badge {
            display: inline-flex;
            align-items: baseline;
            justify-content: center;
            min-width: 12px;
            padding: 1px 4px;
            background: var(--background-highlight-bright);
            color: black;
            font-size: 0.7em;
            line-height: 1.3;
            white-space: nowrap;

            .quantity {
                font-size: 0.9em;
                margin-right: 2px;
            }
        }

        .ammo-location-badge.exposed {
            background: var(--background-warning);
        }

        .ammo-location-badge.destroyed {
            background: var(--damage-color);
        }

        .ammo-control-label > .ammo-name {
            display: flex;
            align-items: center;
            min-height: 32px;
        }

        .ammo-count {
            color: var(--text-color-secondary);
            text-align: right;
            min-width: 48px;
        }

        .ammo-control-label > .ammo-count {
            grid-column: 2;
            display: flex;
            align-items: flex-start;
            justify-content: flex-end;
            min-height: 32px;
            line-height: 1.3;
            padding-top: calc((32px - 1.3em) / 2);
            box-sizing: border-box;
        }

        .ammo-control-row.destroyed-entry > .ammo-control-label > .ammo-count,
        .ammo-bin.destroyed > .ammo-count {
            color: var(--damage-color);
        }

        .ammo-control-actions {
            display: flex;
            gap: 6px;
            align-items: stretch;
            align-self: start;
        }

        .ammo-bin-list {
            grid-column: 1 / -1;
            display: grid;
            gap: 0px 8px;
            font-size: 0.86em;
            margin-top: -4px;
            padding-bottom: 4px;
        }

        .ammo-bin {
            display: grid;
            grid-template-columns: 96px auto minmax(48px, auto);
            gap: 8px;
            align-items: baseline;
            padding: 0;
            border: 0;
            background: transparent;
            color: inherit;
            text-align: left;
            border-left: 1px solid var(--border-color);
            margin-left: 6px;
            padding-top: 4px;
            box-sizing: border-box;
        }

        .ammo-bin-name-wrapper {
            justify-self: start;
            box-sizing: border-box;
            padding-left: 10px;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;

            .ammo-location-badges {
                top: 0px;
            }
        }
        .ammo-bin-name {
            text-decoration: underline dotted var(--text-color-secondary);
        }

        .ammo-bin-adjustments {
            display: inline-flex;
            gap: 4px;
            align-items: center;
        }

        .ammo-bin-adjust {
            display: inline-grid;
            place-items: center;
            width: 24px;
            height: 24px;
            min-height: 0;
            max-height: 24px;
            min-width: 0;
            max-width: 24px;
            padding: 0;
            cursor: pointer;
        }

        .ammo-bin-adjust:disabled {
            opacity: 0.45;
            cursor: default;
        }

        .ammo-control-list.read-only .ammo-bin {
            cursor: default;
        }

        .ammo-control-list.read-only .ammo-bin-name {
            text-decoration: none;
        }

        .ammo-bin.destroyed .ammo-bin-name {
            text-decoration-color: var(--damage-color);
        }

        @container (max-width: 520px) {
            .ammo-control-row {
                grid-template-columns: 1fr;
            }

            .ammo-control-actions {
                justify-content: flex-end;
            }
        }
    `]
})
export class AmmoControlDialogComponent {
    readonly data: AmmoControlDialogData = inject(DIALOG_DATA);
    private readonly dialogRef: DialogRef<void, AmmoControlDialogComponent> = inject(DialogRef);
    private readonly revision = signal(0);
    private readonly expandedGroups = signal<Set<string>>(new Set());
    private readonly expandedEntries = signal<Set<string>>(new Set());

    groups(): AmmoControlGroup[] {
        this.revision();
        return getAmmoControlGroups(this.data.getEntries?.() ?? this.data.entries);
    }

    readOnly(): boolean {
        const entries = this.data.getEntries?.() ?? this.data.entries;
        return this.data.readOnly ?? entries[0]?.owner.readOnly() ?? false;
    }

    isExpanded(group: AmmoControlGroup): boolean {
        this.revision();
        const expandedEntries = this.expandedEntries();
        return this.expandedGroups().has(group.id) || group.entries.some(entry => expandedEntries.has(entry.id));
    }

    toggleGroup(group: AmmoControlGroup): void {
        if (!group.expandable) return;
        const isExpanded = this.isExpanded(group);
        this.expandedGroups.update(groups => {
            const next = new Set(groups);
            if (isExpanded) {
                next.delete(group.id);
            } else {
                next.add(group.id);
            }
            return next;
        });
        this.expandedEntries.update(entries => {
            const next = new Set(entries);
            for (const entry of group.entries) {
                if (isExpanded) {
                    next.delete(entry.id);
                } else {
                    next.add(entry.id);
                }
            }
            return next;
        });
    }

    remaining(entry: AmmoControlEntry): number {
        this.revision();
        return getAmmoEntryRemaining(entry);
    }

    groupRemaining(group: AmmoControlGroup): number {
        this.revision();
        return getAmmoGroupRemaining(group);
    }

    decrement(group: AmmoControlGroup): void {
        if (this.readOnly()) return;
        if (changeAmmoGroupRemaining(group, -1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    increment(group: AmmoControlGroup): void {
        if (this.readOnly()) return;
        if (changeAmmoGroupRemaining(group, 1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    decrementBin(entry: AmmoControlEntry): void {
        if (this.readOnly() || entry.destroyed) return;
        if (changeAmmoEntryRemaining(entry, -1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    incrementBin(entry: AmmoControlEntry): void {
        if (this.readOnly() || entry.destroyed) return;
        if (changeAmmoEntryRemaining(entry, 1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    async setAmmo(group: AmmoControlGroup): Promise<void> {
        if (this.readOnly()) return;
        if (await setAmmoGroup(group, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    async setAmmoBin(entry: AmmoControlEntry): Promise<void> {
        if (this.readOnly()) return;
        if (await setAmmoEntry(entry, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}