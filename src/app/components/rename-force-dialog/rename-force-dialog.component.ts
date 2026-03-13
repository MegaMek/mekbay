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


import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { DataService } from '../../services/data.service';
import type { Force } from '../../models/force.model';
import { type Faction, FACTION_MERCENARY } from '../../models/factions.model';
import { ForceNamerUtil, type FactionDisplayInfo } from '../../utils/force-namer.util';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { FactionDropdownPanelComponent } from './faction-dropdown-panel.component';
import { EMPTY_RESULT, resolveFromGroups } from '../../utils/org-solver.util';
import type { AggregatedGroupSizeResult, GroupSizeResult } from '../../utils/org-types';
import { getAggregatedGroupsResult } from '../../utils/org-namer.util';
import { buildFactionEraTitle, getFactionEraIconFilter } from './faction-era-visuals.util';


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
    action: 'confirm' | 'unset';
}

@Component({
    selector: 'rename-force-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
      <div class="wide-dialog-body">
        <div class="form-fields">
            <label class="field-label" for="name">{{ forceOrganizationalName() }} Name</label>
            <div class="input-wrapper">
                <div class="name-input-wrapper">
                    <div
                        class="field-input"
                        id="name"
                        contentEditable="true"
                        #inputRef
                        autocomplete="off"
                        [attr.data-placeholder]="placeholderName()"
                        [textContent]="data.force.name"
                        (keydown.enter)="submit()"
                        (input)="onInputCleanup($event)"
                        required
                    ></div>
                    @if (nameHasText()) {
                    <button
                        type="button"
                        class="clear-btn"
                        (click)="clearName()"
                        title="Clear"
                        aria-label="Clear"
                        tabindex="-1"
                    >&#10005;</button>
                    }
                </div>
                <button
                    type="button"
                    class="random-button"
                    (click)="fillRandomName()"
                    aria-label="Generate random force name"
                ></button>
            </div>
        </div>

        <div class="form-fields">
            <label class="field-label" for="faction">Faction</label>
            <div #factionTriggerWrapper class="input-wrapper">
              <button id="faction" #factionTrigger class="faction-selector bt-select" (click)="toggleFactionDropdown()">
                @if (selectedFactionDisplay(); as display) {
                  <div class="faction-selector-content">
                    @if (display.faction.img) {
                      <img [src]="display.faction.img" class="faction-selector-icon" [alt]="display.faction.name" />
                    }
                    <div class="faction-selector-details">
                      <div class="faction-selector-header">
                        <span class="faction-selector-name">{{ display.faction.name }}</span>
                        @if (display.faction.id !== FACTION_MERCENARY) {
                          <span class="match-badge">{{ (display.matchPercentage * 100) | number:'1.0-0' }}% match</span>
                        }
                      </div>
                      <div class="faction-selector-eras">
                        @for (eraItem of display.eraAvailability; track eraItem.era.id) {
                          @if (eraItem.era.icon) {
                            <span class="faction-selector-era-chip"
                                    [class.past-era]="eraItem.isBeforeReferenceYear"
                                        [title]="getEraTitle(eraItem)">
                                <img class="faction-selector-era-icon"
                                            [src]="eraItem.era.icon"
                                    [alt]="eraItem.era.name"
                                [class.unavailable]="!eraItem.isAvailable"
                                [style.filter]="getEraIconFilter(eraItem)" />
                            </span>
                          }
                        }
                      </div>
                    </div>
                  </div>
              } @else {
                <span class="placeholder">None</span>
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
      </div>
      @if (!data.force.factionLock) {
        <p class="faction-hint">The faction will change dynamically based on force composition. Confirm to lock it in.</p>
      }
      <div class="wide-dialog-actions">
        <button (click)="submit()" class="bt-button">CONFIRM</button>
        @if (!data.hideUnset) {
          <button (click)="submitUnset()" class="bt-button">UNSET</button>
        }
        <button (click)="close()" class="bt-button">DISMISS</button>
      </div>
    </div>
    `,
    styles: [`
        .unlock-icon {
            font-size: 0.8em;
            opacity: 0.6;
            vertical-align: middle;
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

        .faction-selector {
            box-sizing: border-box;
            flex: 1 1 auto;
            min-width: 0;
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
            justify-content: space-between;
            gap: 6px;
            padding-right: 16px;
        }

        .faction-selector-name {
            font-weight: 600;
        }

        .match-badge {
            font-size: 0.8em;
            color: var(--bt-yellow);
            padding: 2px 6px;
            background: rgba(240, 192, 64, 0.15);
            white-space: nowrap;
        }

        .faction-selector-eras {
            display: flex;
            flex-direction: row;
            align-items: center;
        }

        .faction-selector-era-chip {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 2px;
        }

        .faction-selector-era-chip.past-era::before {
            content: '';
            position: absolute;
            left: -2px;
            top: -1px;
            width: 100%;
            height: 100%;
            background-color: rgba(255, 0, 0, 0.2);
            pointer-events: none;
        }

        .faction-selector-era-icon {
            width: 1.2em;
            height: 1.2em;
            object-fit: contain;
        }

        .faction-selector-era-icon.unavailable {
            opacity: 0.18;
        }

        .placeholder {
            color: #888;
        }

        .faction-hint {
            font-size: 0.85em;
            color: var(--text-color-tertiary);
            margin: 4px 0 0;
            text-align: center;
        }

        .name-input-wrapper {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
        }

        .name-input-wrapper .field-input {
            padding-right: 32px;
        }

        .clear-btn {
            position: absolute;
            right: 4px;
            top: 0;
            bottom: 0;
            margin: auto 0;
            background: transparent;
            border: none;
            color: #999;
            font-size: 1em;
            font-weight: 700;
            cursor: pointer;
            padding: 0 6px;
            height: 32px;
            width: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
            line-height: 1;
            z-index: 1;
        }

        .clear-btn:hover {
            color: #ff4444;
        }

        @media (max-width: 500px) {
            .faction-selector-era-chip {
                padding: 0;
            }
        }

        @media (max-width: 370px) {
            .faction-selector-era-icon {
                height: 0.9em;
                width: 0.9em;
            }
        }
    `]
})

export class RenameForceDialogComponent {
    readonly FACTION_MERCENARY = FACTION_MERCENARY;

    inputRef = viewChild.required<ElementRef<HTMLDivElement>>('inputRef');
    factionTrigger = viewChild.required<ElementRef<HTMLButtonElement>>('factionTrigger');
    factionTriggerWrapper = viewChild.required<ElementRef<HTMLDivElement>>('factionTriggerWrapper');

    public dialogRef: DialogRef<RenameForceDialogResult | null, RenameForceDialogComponent> = inject(DialogRef);
    readonly data: RenameForceDialogData = inject(DIALOG_DATA);
    private dataService = inject(DataService);
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    /** Tracks whether the name input has text */
    nameHasText = signal<boolean>(!!this.data.force.name);

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

    forceSizeResult = computed<AggregatedGroupSizeResult>(() => {
        const units = this.data.force.units();
        if (units.length === 0) {
            return {
                name: EMPTY_RESULT.name,
                tier: EMPTY_RESULT.tier,
                groups: [],
            };
        }
        const factionName = this.selectedFaction()?.name ?? 'Mercenary';
        const techBase = this.data.force.techBase();
        const groupResults: GroupSizeResult[] = this.data.force.groups()
            .filter(g => g.units().length > 0)
            .flatMap(g => g.sizeResult().groups ?? []);
        const resolvedOrg = resolveFromGroups(techBase, factionName, groupResults);
        return getAggregatedGroupsResult(resolvedOrg, techBase, factionName);
    });

    forceOrganizationalName = computed<string>(() => {
        return this.forceSizeResult().name;
    });

    /** Placeholder name based force size. */
    placeholderName = computed<string>(() => {
        return this.data.force.organizationalName() ?? 'Force';
    });

    constructor() { }

    /** Clear the name input */
    clearName(): void {
        const nativeEl = this.inputRef().nativeElement;
        if (!nativeEl) return;
        nativeEl.textContent = '';
        nativeEl.innerHTML = '';
        this.nameHasText.set(false);
        nativeEl.focus();
    }

    /** Clear leftover <br> / whitespace so :empty placeholder works */
    onInputCleanup(event: Event): void {
        const el = event.target as HTMLElement;
        const hasText = !!el.textContent?.trim();
        this.nameHasText.set(hasText);
        if (!hasText) {
            el.innerHTML = '';
        }
    }

    submit() {
        const value = this.inputRef().nativeElement.textContent?.trim() || '';
        this.dialogRef.close({
            name: value,
            faction: this.selectedFaction(),
            action: 'confirm'
        });
    }

    submitUnset() {
        this.dialogRef.close({
            name: '',
            faction: null,
            action: 'unset'
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
        if (randomFaction === this.selectedFaction()) return; // no change
        this.selectedFaction.set(randomFaction);
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
                anchorActiveSelector: '.dropdown-option.active, .none-option.active'
            }
        );

        componentRef.setInput('factions', this.factionDisplayList());
        componentRef.setInput('selectedFactionId', this.selectedFaction()?.id ?? null);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((faction: Faction | null) => {
                this.overlayManager.closeManagedOverlay('faction-dropdown');
                if (faction?.id === this.selectedFaction()?.id) return; // no change
                this.selectedFaction.set(faction);
            });
    }

    private setInputText(text: string): void {
        const nativeEl = this.inputRef().nativeElement;
        if (!nativeEl) return;
        nativeEl.textContent = text;
        this.nameHasText.set(!!text);
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

    getEraTitle = buildFactionEraTitle;

    getEraIconFilter = getFactionEraIconFilter;
}