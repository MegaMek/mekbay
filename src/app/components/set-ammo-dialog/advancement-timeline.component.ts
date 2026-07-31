/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Equipment } from '../../models/equipment.model';
import { formatTechDate, parseTechDate, TechAdvancementDates, type TechDate } from '../../models/entity/types/tech';

export interface AdvancementTimelineItem {
    label: string;
    value: string;
}

export interface AdvancementTimelineSlotLabel {
    long: string;
    short: string;
}

export interface AdvancementTimelineSlot {
    key: string;
    labels: AdvancementTimelineSlotLabel[];
}

export interface AdvancementTimeline {
    label: string;
    cells: AdvancementTimelineCell[];
}

export interface AdvancementTimelineCell {
    key: string;
    items: AdvancementTimelineItem[];
}

export interface EquipmentAdvancementTimeline {
    timelines: AdvancementTimeline[];
    slots: AdvancementTimelineSlot[];
}

@Component({
    selector: 'advancement-timeline',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.compact]': `density() === 'compact'`,
        '[class.regular]': `density() === 'regular'`,
    },
    template: `
        <div class="advancement-timeline-panel">
            <div class="advancement-timeline-rows" [attr.aria-label]="ariaLabel()">
                <div class="advancement-timeline-row header">
                    <div class="advancement-timeline-row-label" aria-hidden="true"></div>
                    <div class="advancement-timeline-track header" [style.grid-template-columns]="timelineSlotGridColumns(slots())">
                        @for (slot of slots(); track slot.key) {
                            <span class="advancement-timeline-header-cell">
                                <span class="label-long">{{ formatTimelineSlotLabels(slot.labels, 'long') }}</span>
                                <span class="label-short">{{ formatTimelineSlotLabels(slot.labels, 'short') }}</span>
                            </span>
                        }
                    </div>
                </div>
                @for (timeline of timelines(); track timeline.label) {
                    <div class="advancement-timeline-row">
                        <div class="advancement-timeline-row-label">{{ timeline.label }}</div>
                        <div class="advancement-timeline-track" [style.grid-template-columns]="timelineGridColumns(timeline)">
                            @for (cell of timeline.cells; let cellIndex = $index; track cell.key) {
                                <div
                                    class="advancement-timeline-cell"
                                    [class.has-event]="cell.items.length > 0"
                                    [class.is-extinction]="isExtinctionCell(cell)"
                                    [class.has-extinction-line]="hasExtinctionLineSegment(timeline.cells, cellIndex)"
                                >
                                    @for (item of cell.items; track item.label) {
                                        <span class="advancement-timeline-event">
                                            <span class="advancement-timeline-value">{{ item.value }}</span>
                                        </span>
                                    }
                                </div>
                            }
                        </div>
                    </div>
                }
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            min-width: 0;
            --timeline-row-label-width: 40px;
            --timeline-row-gap: 10px;
            --timeline-track-gap: 8px;
            --timeline-marker-size: 12px;
            --timeline-row-height: 22px;
            --timeline-value-offset: 4px;
            --timeline-header-font-size: clamp(0.58em, 1.2vw, 0.72em);
            --timeline-value-font-size: clamp(0.72em, 1.7vw, 1em);
            --timeline-label-font-size: 0.74em;
            --timeline-title-font-size: 0.78em;
            --timeline-panel-gap: 8px;
            --timeline-rows-gap: 8px;
            --timeline-rows-padding: 8px;
            --timeline-background: rgba(0, 0, 0, 0.2);
            --timeline-extinction-color: #f00;
            --timeline-extinction-border: #d00;
            --timeline-extinction-background: #300;
            --timeline-extinction-line: #7003;
        }

        :host.compact {
            --timeline-row-label-width: 44px;
            --timeline-row-gap: 8px;
            --timeline-track-gap: 6px;
            --timeline-marker-size: 9px;
            --timeline-row-height: 18px;
            --timeline-value-offset: 4px;
            --timeline-header-font-size: clamp(0.48em, 1.35vw, 0.64em);
            --timeline-value-font-size: clamp(0.6em, 1.9vw, 0.84em);
            --timeline-label-font-size: 0.72em;
            --timeline-panel-gap: 7px;
            --timeline-rows-gap: 7px;
            --timeline-rows-padding: 7px;
            --timeline-background: rgba(0, 0, 0, 0.14);
        }

        .advancement-timeline-panel {
            display: grid;
            gap: var(--timeline-panel-gap);
            min-width: 0;
        }

        .advancement-timeline-rows {
            display: grid;
            gap: var(--timeline-rows-gap);
            min-width: 0;
            padding: var(--timeline-rows-padding);
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: var(--timeline-background);
            container-type: inline-size;
            text-align: left;
        }

        .advancement-timeline-row {
            display: grid;
            grid-template-columns: var(--timeline-row-label-width) minmax(0, 1fr);
            gap: var(--timeline-row-gap);
            align-items: center;
            min-width: 0;
        }

        .advancement-timeline-row.header {
            align-items: end;
        }

        .advancement-timeline-row-label {
            align-self: center;
            color: var(--text-color-secondary);
            font-size: var(--timeline-label-font-size);
            font-weight: 700;
            line-height: 1;
            text-transform: uppercase;
        }

        .advancement-timeline-track {
            position: relative;
            display: grid;
            align-items: center;
            gap: var(--timeline-track-gap);
            min-width: 0;
            min-height: var(--timeline-row-height);
        }
        /*
        .advancement-timeline-track::before {
            content: '';
            position: absolute;
            left: calc(var(--timeline-marker-size) / 2);
            right: calc(var(--timeline-marker-size) / 2);
            top: 50%;
            height: 3px;
            background: var(--bt-yellow-background-transparent);
            transform: translateY(-50%);
        }*/

        .advancement-timeline-track.header {
            min-height: auto;
        }

        .advancement-timeline-track.header::before {
            display: none;
        }

        .advancement-timeline-header-cell {
            min-width: 0;
            color: var(--text-color-secondary);
            font-size: var(--timeline-header-font-size);
            font-weight: 700;
            letter-spacing: 0.04em;
            line-height: 1.1;
            text-transform: uppercase;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: clip;
            text-align: left;
        }

        .advancement-timeline-header-cell .label-short {
            display: none;
        }

        @container (max-width: 580px) {
            :host.regular .advancement-timeline-header-cell .label-long {
                display: none;
            }

            :host.regular .advancement-timeline-header-cell .label-short {
                display: inline;
            }
        }

        @container (max-width: 520px) {
            :host.compact .advancement-timeline-header-cell .label-long {
                display: none;
            }

            :host.compact .advancement-timeline-header-cell .label-short {
                display: inline;
            }
        }

        .advancement-timeline-cell {
            position: relative;
            display: flex;
            align-items: center;
            min-width: 0;
            min-height: var(--timeline-row-height);
            padding-left: calc(var(--timeline-marker-size) + var(--timeline-value-offset));
        }

        .advancement-timeline-cell.has-event::before {
            content: '';
            position: absolute;
            left: 0;
            top: 50%;
            width: var(--timeline-marker-size);
            height: var(--timeline-marker-size);
            box-sizing: border-box;
            border: 2px solid var(--bt-yellow);
            background: #000;
            transform: translateY(-50%);
            z-index: 2;
        }

        .advancement-timeline-cell.has-event.is-extinction::before {
            border-color: var(--timeline-extinction-border);
            background-color: var(--timeline-extinction-background);
        }

        .advancement-timeline-cell::after {
            content: '';
            position: absolute;
            left: calc(var(--timeline-marker-size) / 2);
            right: calc(-1 * (var(--timeline-track-gap) + (var(--timeline-marker-size) / 2)));
            top: 50%;
            height: 3px;
            background: #EAAE3F60;
            transform: translateY(-50%);
            z-index: 1;
        }

        .advancement-timeline-cell.has-extinction-line::after {
            content: '';
            position: absolute;
            left: calc(var(--timeline-marker-size) / 2);
            right: calc(-1 * (var(--timeline-track-gap) + (var(--timeline-marker-size) / 2)));
            top: 50%;
            height: 3px;
            background: var(--timeline-extinction-line);
            transform: translateY(-50%);
            z-index: 1;
        }

        .advancement-timeline-cell:last-child::after {
            right: calc(var(--timeline-marker-size) / 2);
        }

        .advancement-timeline-event {
            display: grid;
            min-width: 0;
            position: relative;
            z-index: 2;
        }

        .advancement-timeline-value {
            font-weight: 500;
            color: var(--text-color);
            font-size: var(--timeline-value-font-size);
            line-height: 1;
            white-space: nowrap;
        }

        .is-extinction .advancement-timeline-value {
            color: var(--timeline-extinction-color);
        }
    `]
})
export class AdvancementTimelineComponent {
    readonly timelines = input.required<readonly AdvancementTimeline[]>();
    readonly slots = input.required<readonly AdvancementTimelineSlot[]>();
    readonly ariaLabel = input('Advancement history');
    readonly density = input<'compact' | 'regular'>('regular');

    timelineGridColumns(timeline: AdvancementTimeline): string {
        return `repeat(${Math.max(1, timeline.cells.length)}, minmax(0, 1fr))`;
    }

    timelineSlotGridColumns(slots: readonly AdvancementTimelineSlot[]): string {
        return `repeat(${Math.max(1, slots.length)}, minmax(0, 1fr))`;
    }

    formatTimelineSlotLabels(labels: readonly AdvancementTimelineSlotLabel[], key: keyof AdvancementTimelineSlotLabel): string {
        return labels.map(label => label[key]).join(' / ');
    }

    isExtinctionCell(cell: AdvancementTimelineCell): boolean {
        return cell.items.some(item => item.label === 'Extinction');
    }

    hasExtinctionLineSegment(cells: readonly AdvancementTimelineCell[], index: number): boolean {
        let isExtinct = false;
        for (let cellIndex = 0; cellIndex <= index; cellIndex++) {
            const cell = cells[cellIndex];
            if (this.isExtinctionCell(cell)) {
                isExtinct = true;
            } else if (cell.items.length > 0) {
                isExtinct = false;
            }
        }
        return isExtinct;
    }
}

export function getEquipmentAdvancementTimeline(equipment: Equipment): EquipmentAdvancementTimeline {
    const rawTimelines = getEquipmentRawAdvancementItems(equipment);
    const slotKeys = Array.from(new Set(rawTimelines.flatMap(timeline => timeline.items.map(item => getTimelineSlotKey(item.value)))))
        .sort(compareTimelineSlotKeys);
    const slots = slotKeys.map(key => ({
        key,
        labels: Array.from(new Set(rawTimelines.flatMap(timeline => timeline.items)
            .filter(item => getTimelineSlotKey(item.value) === key)
            .map(item => item.label)))
            .map(label => ({ long: label, short: getShortTimelineLabel(label) })),
    }));
    const timelines = rawTimelines.map(timeline => ({
        label: timeline.label,
        cells: slotKeys.map(key => ({
            key,
            items: timeline.items.filter(item => getTimelineSlotKey(item.value) === key),
        })),
    }));
    return { timelines, slots };
}

function getEquipmentRawAdvancementItems(equipment: Equipment): Array<{ label: string; items: AdvancementTimelineItem[] }> {
    if (equipment.techBase === 'All') {
        return [
            { label: 'IS', items: getEquipmentAdvancementDateItems(equipment.tech.advancement?.is) },
            { label: 'Clan', items: getEquipmentAdvancementDateItems(equipment.tech.advancement?.clan) },
        ].filter(timeline => timeline.items.length > 0);
    }

    const label = equipment.techBase === 'Clan' ? 'Clan' : 'IS';
    const items = getEquipmentAdvancementDateItems(equipment.techBase === 'Clan'
        ? equipment.tech.advancement?.clan
        : equipment.tech.advancement?.is);
    return items.length > 0 ? [{ label, items }] : [];
}

function getEquipmentAdvancementDateItems(dates: TechAdvancementDates | undefined): AdvancementTimelineItem[] {
    if (!dates) return [];
    const entries: Array<[string, TechDate]> = [
        ['Prototype', dates.prototype],
        ['Production', dates.production],
        ['Common', dates.common],
        ['Extinction', dates.extinct],
        ['Reintroduction', dates.reintroduced],
    ];
    return entries
        .filter((entry): entry is [string, Exclude<TechDate, undefined>] => entry[1] !== undefined)
        .map(([label, value]) => ({ label, value: formatTechDate(value)! }))
        .sort((a, b) => compareTimelineValues(a.value, b.value));
}

function getShortTimelineLabel(label: string): string {
    switch (label) {
        case 'Prototype': return 'Proto';
        case 'Production': return 'Prod.';
        case 'Reintroduction': return 'Reintro';
        case 'Extinction': return 'Extinct';
        default: return label;
    }
}

function getTimelineSlotKey(value: string): string {
    const year = parseTimelineYear(value);
    return year === null ? `text:${value}` : `year:${year}`;
}

function compareTimelineSlotKeys(a: string, b: string): number {
    const aYear = parseTimelineSlotYear(a);
    const bYear = parseTimelineSlotYear(b);
    if (aYear === null && bYear === null) return a.localeCompare(b);
    if (aYear === null) return 1;
    if (bYear === null) return -1;
    return aYear - bYear;
}

function parseTimelineSlotYear(key: string): number | null {
    if (!key.startsWith('year:')) return null;
    const year = Number(key.slice('year:'.length));
    return Number.isFinite(year) ? year : null;
}

function compareTimelineValues(a: string, b: string): number {
    const aYear = parseTimelineYear(a);
    const bYear = parseTimelineYear(b);
    if (aYear === null && bYear === null) return String(a).localeCompare(String(b));
    if (aYear === null) return 1;
    if (bYear === null) return -1;
    return aYear - bYear;
}

function parseTimelineYear(value: string): number | null {
    const date = parseTechDate(value);
    if (date === undefined) return null;
    return typeof date === 'number' ? date : date.year;
}
