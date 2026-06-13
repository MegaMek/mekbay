import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { HandlerContext } from '../../services/equipment-interaction-registry.service';
import type { AmmoControlEntry, AmmoControlGroup } from '../../utils/ammo-interaction.util';
import { changeAmmoGroupRemaining, getAmmoControlGroups, getAmmoEntryRemaining, getAmmoGroupRemaining, setAmmoEntry, setAmmoGroup } from '../../utils/ammo-interaction.util';

export interface AmmoControlDialogData {
    title: string;
    entries: AmmoControlEntry[];
    context: HandlerContext;
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
            <div class="ammo-control-list">
                @for (group of groups(); track group.id) {
                    <div class="ammo-control-row">
                        <div class="ammo-control-label" [class.expandable]="group.expandable">
                            <span class="ammo-location">{{ group.locationLabel }}</span>
                            @if (group.expandable) {
                                <button class="ammo-expand-button" type="button" (click)="toggleGroup(group)">
                                    <svg width="12px" height="12px" fill="currentColor" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" class="chevron" [class.collapsed]="!isExpanded(group)"><path d="M0 2l5 6 5-6z"></path></svg>
                                    <span class="ammo-name">{{ group.displayName }}</span>
                                </button>
                            } @else {
                                <span class="ammo-name">{{ group.displayName }}</span>
                            }
                            <span class="ammo-count">{{ groupRemaining(group) }}/{{ group.totalAmmo }}</span>
                            @if (isExpanded(group)) {
                                <div class="ammo-bin-list">
                                    @for (entry of group.entries; track entry.id) {
                                        <button class="ammo-bin" type="button" (click)="setAmmoBin(entry)" [disabled]="entry.destroyed">
                                            <span class="ammo-bin-name">{{ entry.displayName }}</span>
                                            <span class="ammo-count">{{ remaining(entry) }}/{{ entry.totalAmmo }}</span>
                                        </button>
                                    }
                                </div>
                            }
                        </div>
                        <div class="ammo-control-actions">
                            <button class="bt-button square-small" type="button" (click)="decrement(group)" [disabled]="group.destroyed || groupRemaining(group) <= 0">-1</button>
                            <button class="bt-button square-small" type="button" (click)="increment(group)" [disabled]="group.destroyed || groupRemaining(group) >= group.totalAmmo">+1</button>
                            <button class="bt-button" type="button" (click)="setAmmo(group)" [disabled]="group.destroyed">SET AMMO</button>
                        </div>
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
            padding-right: 4px;
        }

        .ammo-control-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 4px 12px;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid color-mix(in srgb, var(--text-color-secondary) 25%, transparent);
        }

        .ammo-control-row:last-child {
            border-bottom: 0;
        }

        .ammo-control-label {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 0px 8px;
            align-items: baseline;
            min-width: 0;
        }

        .ammo-control-label.expandable {
            grid-template-columns: auto minmax(0, 1fr) auto;
        }

        .ammo-expand-button {
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            gap: 4px;
            min-width: 0;
            padding: 0;
            border: 0;
            background: transparent;
            font: inherit;
            color: var(--text-color-secondary);
            text-align: left;
            cursor: pointer;
        }

        .chevron {
            color: var(--text-color-secondary);
            transition: transform 0.15s ease;
            flex-shrink: 0;
        }

        .chevron.collapsed {
            transform: rotate(-90deg);
        }

        .ammo-location {
            font-weight: 700;
            color: var(--text-color-secondary);
            border-right: 1px solid var(--border-color);
            padding: 4px 8px 4px 0px;
            min-width: 32px;
        }

        .ammo-name {
            color: var(--text-color);
            text-align: left;
        }

        .ammo-count {
            color: var(--text-color-secondary);
            font-variant-numeric: tabular-nums;
        }

        .ammo-control-actions {
            display: flex;
            gap: 6px;
            align-items: center;
            align-self: start;
        }

        .ammo-bin-list {
            grid-column: 2 / -1;
            display: grid;
            gap: 2px;
            margin-left: 8px;
            padding-left: 16px;
            border-left: 1px solid color-mix(in srgb, var(--text-color-secondary) 45%, transparent);
            font-size: 0.86em;
        }

        .ammo-bin {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: baseline;
            padding: 2px 0;
            border: 0;
            background: transparent;
            color: inherit;
            text-align: left;
            cursor: pointer;
        }

        .ammo-bin-name {
            justify-self: start;
            text-decoration: underline dotted var(--text-color-secondary);
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

    groups(): AmmoControlGroup[] {
        this.revision();
        return getAmmoControlGroups(this.data.entries);
    }

    isExpanded(group: AmmoControlGroup): boolean {
        this.revision();
        return this.expandedGroups().has(group.id);
    }

    toggleGroup(group: AmmoControlGroup): void {
        if (!group.expandable) return;
        this.expandedGroups.update(groups => {
            const next = new Set(groups);
            if (next.has(group.id)) {
                next.delete(group.id);
            } else {
                next.add(group.id);
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
        if (changeAmmoGroupRemaining(group, -1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    increment(group: AmmoControlGroup): void {
        if (changeAmmoGroupRemaining(group, 1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    async setAmmo(group: AmmoControlGroup): Promise<void> {
        if (await setAmmoGroup(group, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    async setAmmoBin(entry: AmmoControlEntry): Promise<void> {
        if (await setAmmoEntry(entry, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}