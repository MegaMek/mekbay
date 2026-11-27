// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import { forceMemberAdjustedValue, type ForceMember } from '../../models/force-member.model';
import { calculateAdjustedBV } from '../../utils/cbt-common.util';
import { adjustPointValueForSkill } from '../../utils/pv-skill-adjustment.util';
import type { UnitConditionDisplay } from '../../utils/force-member-conditions.util';
import { LayoutService } from '../../services/layout.service';
import { UnitNameService } from '../../services/unit-name.service';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, type TagClickEvent } from '../unit-tags/unit-tags.component';

/** The value a unit's header shows, and what it differs from. */
export interface UnitValueDisplay {
    readonly label: 'BV' | 'PV';
    readonly value: number;
    /** The unadjusted value, when the shown one differs from it. */
    readonly base: number | null;
    /** The skills a catalog unit's value is priced at, when they change it. */
    readonly skills: string | null;
}

/** The value shown for a unit: a force member's own, a search's override, or the base at the given skills. */
export function unitDetailsAdjustedValue(
    unit: UnitSummary,
    member: ForceMember | undefined,
    damageMode: Parameters<typeof forceMemberAdjustedValue>[1],
    override: number | undefined,
    gunnery: number | undefined,
    piloting: number | undefined,
    isAlphaStrike: boolean,
): number | null {
    if (member) return forceMemberAdjustedValue(member, damageMode);
    if (override !== undefined) return override;
    if (gunnery === undefined || piloting === undefined) return null;
    return isAlphaStrike ? adjustPointValueForSkill(unit.as.PV, gunnery) : calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
}

export function shouldShowAdjustedPilotSkills(
    adjustedBv: number | null,
    baseBv: number,
    gunnery: number | undefined,
    piloting: number | undefined,
): boolean {
    return adjustedBv !== null
        && Number.isFinite(adjustedBv)
        && adjustedBv !== baseBv
        && Number.isFinite(gunnery)
        && Number.isFinite(piloting);
}

/** The header value for a unit, priced under the game system it plays. */
export function unitValueDisplay(
    unit: UnitSummary,
    member: ForceMember | undefined,
    damageMode: Parameters<typeof forceMemberAdjustedValue>[1],
    override: number | undefined,
    gunnery: number | undefined,
    piloting: number | undefined,
    isAlphaStrike: boolean,
): UnitValueDisplay {
    const base = isAlphaStrike ? unit.as.PV : unit.bv;
    const adjusted = unitDetailsAdjustedValue(unit, member, damageMode, override, gunnery, piloting, isAlphaStrike);
    const value = adjusted ?? base;
    return {
        label: isAlphaStrike ? 'PV' : 'BV',
        value,
        base: value !== base ? base : null,
        skills: !member && shouldShowAdjustedPilotSkills(adjusted, base, gunnery, piloting)
            ? isAlphaStrike ? `Skill ${gunnery}` : `${gunnery}/${piloting}` : null,
    };
}

/**
 * A unit's identity in a details header: model over chassis on the left, the value on the right
 * with what it differs from above it. Shared by the details dialog and the search sidebar.
 */
@Component({
    selector: 'unit-identity-bar',
    imports: [UnitIconComponent, UnitTagsComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[class.clipped]': 'clipped()' },
    template: `
        <unit-icon class="idbar-icon" [unit]="unit()" [size]="layout.isPhone() ? 40 : 52"></unit-icon>
        <div class="idbar-model allow-select">{{ unit().model }}</div>
        @if (value().skills; as skills) {
            <span class="idbar-note allow-select">at {{ skills }}</span>
        } @else if (value().base !== null) {
            <span class="idbar-note allow-select">base {{ value().base!.toLocaleString('en-US') }}</span>
        }
        <div class="idbar-name">
            <span class="idbar-chassis allow-select">{{ unitNames.chassis(unit()) }}</span>
            @if (unit().isCustom) { <span class="custom-unit-badge">CUSTOM</span> }
            @for (condition of conditions(); track condition.key) {
                <span class="idbar-condition" [style.--condition-color]="condition.color">{{ condition.label }}</span>
            }
            @if (showTags()) {
                <unit-tags class="idbar-tags" [unit]="unit()" mode="compact" (tagClick)="tagClick.emit($event)"></unit-tags>
            }
        </div>
        <div class="idbar-value allow-select">
            <span class="idbar-value-label">{{ value().label }}</span>
            <span class="idbar-value-number">{{ value().value.toLocaleString('en-US') }}</span>
        </div>
    `,
    styles: `
        /* Two baselines: model and the value's basis, then chassis and the value. */
        :host {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            grid-template-areas:
                'icon model note'
                'icon name  value';
            align-items: baseline;
            column-gap: 14px;
            padding: 12px 12px 4px 8px;
        }

        /* Clear of a dialog frame's top stripes and clipped corner. */
        :host(.clipped) {
            padding-right: 32px;
        }

        .idbar-icon {
            grid-area: icon;
            align-self: center;
            margin-right: -4px;
        }

        .idbar-model {
            grid-area: model;
            overflow: hidden;
            color: var(--text-color-secondary);
            font-size: 1.15em;
            line-height: 1.15;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .idbar-name {
            grid-area: name;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 2px 8px;
            min-width: 0;
        }

        .idbar-chassis {
            font-size: 1.55em;
            font-weight: bold;
            letter-spacing: 0.05em;
            line-height: 1.15;
        }

        .idbar-condition {
            padding: 1px 5px;
            background: color-mix(in srgb, var(--condition-color) 100%, transparent 50%);
            color: #fff;
            font-size: 0.72em;
            font-weight: 600;
            white-space: nowrap;
        }

        .idbar-tags {
            align-self: center;
            margin-left: auto;
        }

        .idbar-note {
            grid-area: note;
            justify-self: end;
            color: var(--text-color-secondary);
            font-size: 0.8em;
            white-space: nowrap;
        }

        .idbar-value {
            grid-area: value;
            display: flex;
            align-items: baseline;
            justify-self: end;
            gap: 4px;
            line-height: 1.15;
            white-space: nowrap;
        }

        .idbar-value-label {
            color: var(--text-color-tertiary);
            font-size: 0.7em;
            font-weight: 600;
            letter-spacing: 0.1em;
        }

        .idbar-value-number {
            font-size: 1.55em;
            font-weight: bold;
            font-variant-numeric: tabular-nums;
        }

        /* A short viewport keeps the header tight. */
        @media (max-height: 550px) {
            :host {
                padding-top: 6px;
                padding-bottom: 2px;
            }

            .idbar-model {
                font-size: 0.9em;
            }

            .idbar-chassis {
                font-size: 1.2em;
            }

            .idbar-value-number {
                font-size: 1.25em;
            }
        }

        /* A phone keeps one line per row: smaller type and gaps. */
        @container (max-width: 500px) {
            :host {
                column-gap: 10px;
            }

            :host(.clipped) {
                padding-right: 20px;
            }

            .idbar-model {
                font-size: 1em;
            }

            .idbar-chassis {
                font-size: 1.3em;
                letter-spacing: 0.02em;
            }

            .idbar-value-number {
                font-size: 1.35em;
            }
        }
    `,
})
export class UnitIdentityBarComponent {
    readonly unitNames = inject(UnitNameService);
    readonly layout = inject(LayoutService);
    readonly unit = input.required<UnitSummary>();
    readonly value = input.required<UnitValueDisplay>();
    readonly conditions = input<readonly UnitConditionDisplay[]>([]);
    /** A compact tags button, for tabs that do not list the tags themselves. */
    readonly showTags = input(false);
    /** The host frame clips its top-right corner. */
    readonly clipped = input(false);
    readonly tagClick = output<TagClickEvent>();
}
