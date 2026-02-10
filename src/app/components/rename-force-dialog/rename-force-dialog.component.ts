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


import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { ForceBuilderService } from '../../services/force-builder.service';
import { DataService } from '../../services/data.service';
import { Force } from '../../models/force.model';
import { Faction } from '../../models/factions.model';
import { ForceNamerUtil, FactionDisplayInfo } from '../../utils/force-namer.util';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { FactionDropdownPanelComponent } from './faction-dropdown-panel.component';


/*
 * Author: Drake
 */
export interface RenameForceDialogData {
    force: Force;
    hideUnset?: boolean;
}

export interface RenameForceDialogResult {
    name: string;
    faction: Faction | null;
}

@Component({
    selector: 'rename-force-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
      <h2 dialog-title></h2>
      <div dialog-content>
        <p>Force Name</p>
        <div class="input-wrapper">
          <div
            class="input"
            contentEditable="true"
            #inputRef
            [textContent]="data.force.name"
            (keydown.enter)="submit()"
            required
          ></div>
          <button
            type="button"
            class="random-button"
            (click)="fillRandomName()"
            aria-label="Generate random force name"
          ></button>
        </div>

        <p>Faction</p>
        <div #factionTriggerWrapper class="input-wrapper">
          <button #factionTrigger class="faction-selector bt-select" (click)="toggleFactionDropdown()">
            @if (selectedFactionDisplay(); as display) {
              <div class="faction-selector-content">
                @if (display.faction.img) {
                  <img [src]="display.faction.img" class="faction-selector-icon" [alt]="display.faction.name" />
                }
                <div class="faction-selector-details">
                  <div class="faction-selector-header">
                    <span class="faction-selector-name">{{ display.faction.name }}</span>
                  </div>
                  <div class="faction-selector-eras">
                    @for (eraItem of display.eraAvailability; track eraItem.era.id) {
                      @if (eraItem.era.icon) {
                        <img class="faction-selector-era-icon"
                             [src]="eraItem.era.icon"
                             [alt]="eraItem.era.name"
                             [class.unavailable]="!eraItem.isAvailable" />
                      }
                    }
                  </div>
                </div>
              </div>
          } @else {
            <span class="placeholder">No faction selected</span>
          }
          </button>
          <button
            type="button"
            class="random-button"
            (click)="fillRandomFaction()"
            aria-label="Pick random faction"
          ></button>
        </div>
      </div>
      <div dialog-actions>
        <button (click)="submit()" class="bt-button">CONFIRM</button>
        @if (!data.hideUnset) {
          <button (click)="submitEmpty()" class="bt-button">UNSET</button>
        }
        <button (click)="close()" class="bt-button">DISMISS</button>
      </div>
    </div>
    `,
    styles: [`
        .content {
            display: block;
            max-width: 1000px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }

        [dialog-content] .input {
            width: calc(90vw - 32px);
            max-width: 500px;
            font-size: 1.5em;
            background: var(--background-input);
            color: white;
            border: 0;
            border-bottom: 1px solid #666;
            text-align: center;
            outline: none;
            transition: all 0.2s ease-in-out;
            padding-left: 32px;
            white-space: normal;
            overflow-wrap: break-word;
            word-break: break-word;
        }

        [dialog-content] .input:focus {
            border-bottom: 1px solid #fff;
            outline: none;
        }

        .input-wrapper {
            position: relative;
            display: inline-flex;
            align-items: center;
            box-sizing: border-box;
        }

        .random-button {
            flex-shrink: 0;
            height: 32px;
            width: 32px;
            border: none;
            background: transparent url('/images/random.svg') center/24px 24px no-repeat;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s ease-in-out;
        }

        .random-button:hover,
        .random-button:focus {
            opacity: 1;
        }

        [dialog-actions] {
            padding-top: 8px;
            display: flex;
            gap: 8px;
            justify-content: center;
            flex-wrap: wrap;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }

        .faction-selector {
            width: calc(90vw - 64px);
            max-width: 500px;
            padding: 10px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            text-align: left;
            font-size: 1em;
        }

        .faction-selector:hover {
            border-color: #666;
        }

        .faction-selector-content {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
        }

        .faction-selector-icon {
            width: 2.4em;
            height: 2.4em;
            object-fit: contain;
            flex-shrink: 0;
        }

        .faction-selector-details {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
        }

        .faction-selector-header {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .faction-selector-name {
            font-weight: 600;
        }

        .faction-selector-eras {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 2px;
        }

        .faction-selector-era-icon {
            width: 1.2em;
            height: 1.2em;
            object-fit: contain;
        }

        .faction-selector-era-icon.unavailable {
            opacity: 0.15;
        }

        .placeholder {
            color: #888;
        }
    `]
})

export class RenameForceDialogComponent {
    inputRef = viewChild.required<ElementRef<HTMLDivElement>>('inputRef');
    factionTrigger = viewChild.required<ElementRef<HTMLButtonElement>>('factionTrigger');
    factionTriggerWrapper = viewChild.required<ElementRef<HTMLDivElement>>('factionTriggerWrapper');

    public dialogRef: DialogRef<RenameForceDialogResult | null, RenameForceDialogComponent> = inject(DialogRef);
    readonly data: RenameForceDialogData = inject(DIALOG_DATA);
    private forceBuilder = inject(ForceBuilderService);
    private dataService = inject(DataService);
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    selectedFaction = signal<Faction | null>(this.data.force.faction());

    selectedFactionDisplay = computed<FactionDisplayInfo | null>(() => {
        const faction = this.selectedFaction();
        if (!faction) return null;
        return this.factionDisplayList().find(f => f.faction.id === faction.id) ?? null;
    });

    factionDisplayList = computed<FactionDisplayInfo[]>(() => {
        const units = this.data.force.units();
        return ForceNamerUtil.buildFactionDisplayList(
            units,
            this.dataService.getFactions(),
            this.dataService.getEras()
        );
    });

    constructor() {}

    submit() {
        const value = this.inputRef().nativeElement.textContent?.trim() || '';
        this.dialogRef.close({
            name: value,
            faction: this.selectedFaction()
        });
    }

    submitEmpty() {
        this.dialogRef.close({
            name: '',
            faction: this.selectedFaction()
        });
    }

    fillRandomName() {
        const faction = this.selectedFaction();
        const newName = ForceNamerUtil.generateForceNameForFaction(faction);
        this.setInputText(newName);
    }

    fillRandomFaction() {
        const units = this.data.force.units();
        const randomFaction = ForceNamerUtil.pickRandomFaction(
            units,
            this.dataService.getFactions(),
            this.dataService.getEras()
        );
        this.selectedFaction.set(randomFaction);
        // Also regenerate name for the new faction
        const newName = ForceNamerUtil.generateForceNameForFaction(randomFaction);
        this.setInputText(newName);
    }

    toggleFactionDropdown(): void {
        this.overlayManager.closeManagedOverlay('faction-dropdown');

        const factionTriggerWrapper = this.factionTriggerWrapper();
        if (!factionTriggerWrapper) return;

        const portal = new ComponentPortal(FactionDropdownPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            'faction-dropdown',
            factionTriggerWrapper,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'faction-dropdown-overlay',
                matchTriggerWidth: true,
                fullHeight: true
            }
        );

        componentRef.setInput('factions', this.factionDisplayList());
        componentRef.setInput('selectedFactionId', this.selectedFaction()?.id ?? null);

        // Pass the trigger's vertical center so the panel scrolls the active item to align with it
        const triggerEl = factionTriggerWrapper.nativeElement ?? factionTriggerWrapper;
        const triggerRect = (triggerEl as HTMLElement).getBoundingClientRect();
        componentRef.setInput('triggerY', triggerRect.top + triggerRect.height / 2);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((faction: Faction | null) => {
                this.selectedFaction.set(faction);
                this.overlayManager.closeManagedOverlay('faction-dropdown');

                // Auto-update force name when faction is changed (unless name is locked)
                if (faction && !this.data.force.nameLock) {
                    const newName = ForceNamerUtil.generateForceNameForFaction(faction);
                    this.setInputText(newName);
                }
            });
    }

    private setInputText(text: string): void {
        const nativeEl = this.inputRef().nativeElement;
        if (!nativeEl) return;
        nativeEl.textContent = text;
        nativeEl.focus();
        const range = document.createRange();
        range.selectNodeContents(nativeEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    close(value = null) {
        this.dialogRef.close(null);
    }
}