import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { HandlerContext } from '../../services/equipment-interaction-registry.service';
import type { AmmoControlEntry } from '../../utils/ammo-interaction.util';
import { changeAmmoEntryRemaining, getAmmoEntryRemaining, setAmmoEntry } from '../../utils/ammo-interaction.util';

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
                @for (entry of data.entries; track entry.id) {
                    <div class="ammo-control-row">
                        <div class="ammo-control-label">
                            <span class="ammo-location">{{ entry.locationLabel }}</span>
                            <span class="ammo-name">{{ entry.displayName }}</span>
                            <span class="ammo-count">{{ remaining(entry) }}/{{ entry.totalAmmo }}</span>
                        </div>
                        <div class="ammo-control-actions">
                            <button class="bt-button square-small" type="button" (click)="decrement(entry)" [disabled]="entry.destroyed || remaining(entry) <= 0">-1</button>
                            <button class="bt-button square-small" type="button" (click)="increment(entry)" [disabled]="entry.destroyed || remaining(entry) >= entry.totalAmmo">+1</button>
                            <button class="bt-button" type="button" (click)="setAmmo(entry)" [disabled]="entry.destroyed">SET AMMO</button>
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
            gap: 8px;
        }

        .ammo-control-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 12px;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px solid color-mix(in srgb, var(--text-color-secondary) 25%, transparent);
        }

        .ammo-control-row:last-child {
            border-bottom: 0;
        }

        .ammo-control-label {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 8px;
            align-items: baseline;
            min-width: 0;
        }

        .ammo-location {
            font-weight: 700;
            color: var(--text-color-secondary);
            border-right: 1px solid var(--border-color);
            padding: 4px 8px 4px 0px;
        }

        .ammo-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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

    remaining(entry: AmmoControlEntry): number {
        this.revision();
        return getAmmoEntryRemaining(entry);
    }

    decrement(entry: AmmoControlEntry): void {
        if (changeAmmoEntryRemaining(entry, -1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    increment(entry: AmmoControlEntry): void {
        if (changeAmmoEntryRemaining(entry, 1, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    async setAmmo(entry: AmmoControlEntry): Promise<void> {
        if (await setAmmoEntry(entry, this.data.context)) {
            this.revision.update(value => value + 1);
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}