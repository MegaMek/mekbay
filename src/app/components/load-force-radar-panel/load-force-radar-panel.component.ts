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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { DataService, DOES_NOT_TRACK, type MinMaxStatsRange } from '../../services/data.service';

type RadarStatKey =
    | 'armor'
    | 'internal'
    | 'range'
    | 'dpt'
    | 'mobility'
    | 'endurance'
    | 'shortRangeDamage'
    | 'mediumRangeDamage'
    | 'longRangeDamage';

interface RadarContribution {
    value: number;
    min: number;
    average: number;
    max: number;
}

interface RadarPoint {
    x: number;
    y: number;
}

interface RadarAxisDefinition {
    key: RadarStatKey;
    label: string;
    getContribution: (unit: Unit, bucketStats: MinMaxStatsRange) => RadarContribution;
}

interface RadarAxis {
    key: RadarStatKey;
    label: string;
    angle: number;
    value: number;
    min: number;
    average: number;
    max: number;
    ratio: number;
    valueText: string;
    maxText: string;
    axisPoint: RadarPoint;
    dataPoint: RadarPoint;
    labelPoint: RadarPoint;
    textAnchor: 'start' | 'middle' | 'end';
}

const CLASSIC_RADAR_AXIS_DEFINITIONS: readonly RadarAxisDefinition[] = [
    {
        key: 'mobility',
        label: 'Mobility',
        getContribution: (unit, bucketStats) => getMobilityContribution(unit, bucketStats),
    },
    {
        key: 'endurance',
        label: 'Endurance',
        getContribution: (unit, bucketStats) => ({
            value: sanitizeStatValue(unit.armor) + sanitizeStatValue(unit.internal),
            min: sanitizeStatValue(bucketStats.armor.min) + sanitizeStatValue(bucketStats.internal.min),
            average: sanitizeStatValue(bucketStats.armor.average) + sanitizeStatValue(bucketStats.internal.average),
            max: sanitizeStatValue(bucketStats.armor.max) + sanitizeStatValue(bucketStats.internal.max),
        }),
    },
    {
        key: 'range',
        label: 'Range',
        getContribution: (unit, bucketStats) => ({
            value: sanitizeStatValue(unit._weightedMaxRange),
            min: sanitizeStatValue(bucketStats.weightedMaxRange.min),
            average: sanitizeStatValue(bucketStats.weightedMaxRange.average),
            max: sanitizeStatValue(bucketStats.weightedMaxRange.max),
        }),
    },
    {
        key: 'dpt',
        label: 'Damage',
        getContribution: (unit, bucketStats) => ({
            value: sanitizeStatValue(unit.dpt),
            min: sanitizeStatValue(bucketStats.dpt.min),
            average: sanitizeStatValue(bucketStats.dpt.average),
            max: sanitizeStatValue(bucketStats.dpt.max),
        }),
    },
] as const;

const ALPHA_STRIKE_RADAR_AXIS_DEFINITIONS: readonly RadarAxisDefinition[] = [
    {
        key: 'mobility',
        label: 'Mobility',
        getContribution: (unit, bucketStats) => ({
            value: sanitizeStatValue(unit.as?.TMM),
            min: sanitizeStatValue(bucketStats.asTmm.min),
            average: sanitizeStatValue(bucketStats.asTmm.average),
            max: sanitizeStatValue(bucketStats.asTmm.max),
        }),
    },
    {
        key: 'endurance',
        label: 'Endurance',
        getContribution: (unit, bucketStats) => ({
            value: sanitizeStatValue(unit.as?.Arm) + sanitizeStatValue(unit.as?.Str),
            min: sanitizeStatValue(bucketStats.asArm.min) + sanitizeStatValue(bucketStats.asStr.min),
            average: sanitizeStatValue(bucketStats.asArm.average) + sanitizeStatValue(bucketStats.asStr.average),
            max: sanitizeStatValue(bucketStats.asArm.max) + sanitizeStatValue(bucketStats.asStr.max),
        }),
    },
    {
        key: 'shortRangeDamage',
        label: 'Damage (S)',
        getContribution: (unit, bucketStats) => ({
            value: getASDamageValue(unit.as?.dmg._dmgS, unit.as?.dmg.dmgS),
            min: sanitizeStatValue(bucketStats.asDmgS.min),
            average: sanitizeStatValue(bucketStats.asDmgS.average),
            max: sanitizeStatValue(bucketStats.asDmgS.max),
        }),
    },
    {
        key: 'mediumRangeDamage',
        label: 'Damage (M)',
        getContribution: (unit, bucketStats) => ({
            value: getASDamageValue(unit.as?.dmg._dmgM, unit.as?.dmg.dmgM),
            min: sanitizeStatValue(bucketStats.asDmgM.min),
            average: sanitizeStatValue(bucketStats.asDmgM.average),
            max: sanitizeStatValue(bucketStats.asDmgM.max),
        }),
    },
    {
        key: 'longRangeDamage',
        label: 'Damage (L)',
        getContribution: (unit, bucketStats) => ({
            value: getASDamageValue(unit.as?.dmg._dmgL, unit.as?.dmg.dmgL),
            min: sanitizeStatValue(bucketStats.asDmgL.min),
            average: sanitizeStatValue(bucketStats.asDmgL.average),
            max: sanitizeStatValue(bucketStats.asDmgL.max),
        }),
    },
] as const;

const RADAR_VIEWBOX_WIDTH = 500;
const RADAR_VIEWBOX_HEIGHT = 400;
const RADAR_CENTER_X = RADAR_VIEWBOX_WIDTH / 2;
const RADAR_CENTER_Y = RADAR_VIEWBOX_HEIGHT / 2;
const RADAR_RADIUS = 140;
const RADAR_LABEL_RADIUS = 170;
const RADAR_LABEL_SAFE_X = 58;
const RADAR_LABEL_SAFE_TOP = 22;
const RADAR_LABEL_SAFE_BOTTOM = 50;
const RADAR_RING_FACTORS = [0.25, 0.5, 0.75, 1] as const;

function roundCoordinate(value: number): number {
    return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function toPoint(angleDegrees: number, distance: number): RadarPoint {
    const radians = angleDegrees * Math.PI / 180;
    return {
        x: roundCoordinate(RADAR_CENTER_X + Math.cos(radians) * distance),
        y: roundCoordinate(RADAR_CENTER_Y + Math.sin(radians) * distance),
    };
}

function toPointString(points: readonly RadarPoint[]): string {
    return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function getAngle(index: number, axisCount: number): number {
    return -90 + ((360 / axisCount) * index);
}

function getTextAnchor(_point: RadarPoint): 'start' | 'middle' | 'end' {
    return 'middle';
}

function getLabelPoint(angleDegrees: number): RadarPoint {
    const point = toPoint(angleDegrees, RADAR_LABEL_RADIUS);
    return {
        x: roundCoordinate(clamp(point.x, RADAR_LABEL_SAFE_X, RADAR_VIEWBOX_WIDTH - RADAR_LABEL_SAFE_X)),
        y: roundCoordinate(clamp(point.y, RADAR_LABEL_SAFE_TOP, RADAR_VIEWBOX_HEIGHT - RADAR_LABEL_SAFE_BOTTOM)),
    };
}

function sanitizeStatValue(value: number | undefined | null): number {
    if (value === undefined || value === null || !Number.isFinite(value) || value === DOES_NOT_TRACK) {
        return 0;
    }

    return Math.max(0, value);
}

function getMobilityContribution(unit: Unit, bucketStats: MinMaxStatsRange): RadarContribution {
    const runValue = sanitizeStatValue(unit.run2);
    const jumpValue = sanitizeStatValue(unit.jump);
    const runMin = sanitizeStatValue(bucketStats.run2MP.min);
    const runAverage = sanitizeStatValue(bucketStats.run2MP.average);
    const jumpMin = sanitizeStatValue(bucketStats.jumpMP.min);
    const jumpAverage = sanitizeStatValue(bucketStats.jumpMP.average);
    const runMax = sanitizeStatValue(bucketStats.run2MP.max);
    const jumpMax = sanitizeStatValue(bucketStats.jumpMP.max);

    if (runValue > jumpValue) {
        return { value: runValue, min: runMin, average: runAverage, max: runMax };
    }

    if (jumpValue > runValue) {
        return { value: jumpValue, min: jumpMin, average: jumpAverage, max: jumpMax };
    }

    if (runMax < jumpMax) {
        return { value: runValue, min: runMin, average: runAverage, max: runMax };
    }

    if (jumpMax < runMax) {
        return { value: jumpValue, min: jumpMin, average: jumpAverage, max: jumpMax };
    }

    if (runMin < jumpMin) {
        return { value: runValue, min: runMin, average: runAverage, max: runMax };
    }

    if (jumpMin < runMin) {
        return { value: jumpValue, min: jumpMin, average: jumpAverage, max: jumpMax };
    }

    return {
        value: runValue,
        min: runMin,
        average: Math.min(runAverage, jumpAverage),
        max: runMax,
    };
}

function getASDamageValue(precomputed: number | undefined, rawValue: string | undefined): number {
    if (precomputed !== undefined) {
        return sanitizeStatValue(precomputed);
    }

    const parsedValue = Number.parseFloat(rawValue ?? '');
    return sanitizeStatValue(parsedValue);
}

function formatStatValue(value: number): string {
    const roundedValue = Math.round(value * 10) / 10;
    if (Number.isInteger(roundedValue)) {
        return roundedValue.toLocaleString('en-US');
    }

    return roundedValue.toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
}

function getRadarRatio(value: number, min: number, average: number, max: number): number {
    if (max <= min) {
        if (value < average) {
            return 0;
        }

        if (value > average) {
            return 1;
        }

        return average > 0 ? 0.5 : 0;
    }

    const clampedAverage = clamp(average, min, max);

    if (value === clampedAverage) {
        return clampedAverage > 0 ? 0.5 : 0;
    }

    if (value < clampedAverage) {
        const lowerSpan = clampedAverage - min;
        if (lowerSpan <= 0) {
            return 0;
        }

        const lowerValue = clamp(value, min, clampedAverage);
        return clamp(0.5 * ((lowerValue - min) / lowerSpan), 0, 1);
    }

    const upperSpan = max - clampedAverage;
    if (upperSpan <= 0) {
        return 1;
    }

    const upperValue = clamp(value, clampedAverage, max);
    return clamp(0.5 + (0.5 * ((upperValue - clampedAverage) / upperSpan)), 0, 1);
}

function buildRadarAxis(
    definition: RadarAxisDefinition,
    index: number,
    axisCount: number,
    contribution: RadarContribution,
): RadarAxis {
    const angle = getAngle(index, axisCount);
    const ratio = getRadarRatio(contribution.value, contribution.min, contribution.average, contribution.max);
    const labelPoint = getLabelPoint(angle);

    return {
        key: definition.key,
        label: definition.label,
        angle,
        value: contribution.value,
        min: contribution.min,
        average: contribution.average,
        max: contribution.max,
        ratio,
        valueText: formatStatValue(contribution.value),
        maxText: formatStatValue(contribution.max),
        axisPoint: toPoint(angle, RADAR_RADIUS),
        dataPoint: toPoint(angle, RADAR_RADIUS * ratio),
        labelPoint,
        textAnchor: getTextAnchor(labelPoint),
    };
}

function getUnitBucketMaxStats(dataService: DataService, gameSystem: GameSystem, unit: Unit): MinMaxStatsRange {
    return gameSystem === GameSystem.ALPHA_STRIKE
        ? dataService.getASUnitTypeMaxStats(unit.as?.TP ?? '')
        : dataService.getUnitSubtypeMaxStats(unit.subtype);
}

@Component({
    selector: 'load-force-radar-panel',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @let axes = chartAxes();
    @let overlayAxes = hoveredUnitAxes();
    @let overlayAxisMap = hoveredAxisMap();
    <div class="force-radar-shell">
        @if (hasUnits()) {
            <div class="radar-area">
                <svg
                    class="radar-chart"
                    [attr.viewBox]="'0 0 ' + viewBoxWidth + ' ' + viewBoxHeight"
                    [attr.width]="viewBoxWidth"
                    [attr.height]="viewBoxHeight"
                    preserveAspectRatio="xMidYMid meet"
                    role="img">

                    @for (ringPoints of gridPolygonPoints(); track $index) {
                        <polygon class="radar-ring" [attr.points]="ringPoints"></polygon>
                    }

                    @for (axis of axes; track axis.key) {
                        <line
                            class="radar-axis"
                            [attr.x1]="centerX"
                            [attr.y1]="centerY"
                            [attr.x2]="axis.axisPoint.x"
                            [attr.y2]="axis.axisPoint.y"></line>
                    }

                    <polygon class="radar-fill" [attr.points]="valuePolygonPoints()"></polygon>
                    <polygon class="radar-outline" [attr.points]="valuePolygonPoints()"></polygon>

                    @for (axis of axes; track axis.key) {
                        <circle
                            class="radar-node"
                            [attr.cx]="axis.dataPoint.x"
                            [attr.cy]="axis.dataPoint.y"
                            r="3.5"></circle>
                    }

                    @if (overlayAxes.length > 0) {
                        <polygon class="radar-hover-fill" [attr.points]="hoveredValuePolygonPoints()"></polygon>
                        <polygon class="radar-hover-outline" [attr.points]="hoveredValuePolygonPoints()"></polygon>

                        @for (axis of overlayAxes; track axis.key) {
                            <circle
                                class="radar-hover-node"
                                [attr.cx]="axis.dataPoint.x"
                                [attr.cy]="axis.dataPoint.y"
                                r="3.5"></circle>
                        }
                    }

                    <circle class="radar-center" [attr.cx]="centerX" [attr.cy]="centerY" r="2.5"></circle>

                    @for (axis of axes; track axis.key) {
                        <g
                            class="radar-label-group"
                            [attr.transform]="'translate(' + axis.labelPoint.x + ' ' + axis.labelPoint.y + ')'">
                            <text class="radar-label" [attr.text-anchor]="axis.textAnchor">{{ axis.label }}</text>
                            <text class="radar-label-value" [attr.text-anchor]="axis.textAnchor" y="16">
                                {{ axis.valueText }}/{{ axis.maxText }}
                            </text>
                            @if (overlayAxisMap.get(axis.key); as overlayAxis) {
                                <text class="radar-label-value radar-label-value-hover" [attr.text-anchor]="axis.textAnchor" y="32">
                                    {{ overlayAxis.valueText }}/{{ overlayAxis.maxText }}
                                </text>
                            }
                        </g>
                    }
                </svg>
            </div>
        } @else {
            <div class="radar-empty">No units to chart.</div>
        }
    </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
        }

        .force-radar-shell {
            width: 100%;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, #333);
            box-sizing: border-box;
            overflow: hidden;
        }

        .radar-area {
            width: 100%;
            padding: 0 2px;
            box-sizing: border-box;
            overflow: hidden;
        }

        .radar-chart {
            display: block;
            width: 100%;
            height: auto;
        }

        .radar-ring {
            fill: none;
            stroke: rgba(255, 255, 255, 0.14);
            stroke-width: 1;
        }

        .radar-axis {
            stroke: rgba(255, 255, 255, 0.18);
            stroke-width: 1;
        }

        .radar-fill {
            fill: rgba(234, 174, 63, 0.22);
        }

        .radar-outline {
            fill: none;
            stroke: var(--bt-yellow, #eaae3f);
            stroke-width: 2;
        }

        .radar-hover-fill {
            fill: rgba(98, 196, 255, 0.16);
        }

        .radar-hover-outline {
            fill: none;
            stroke: #62c4ff;
            stroke-width: 2;
            stroke-dasharray: 6 4;
        }

        .radar-node {
            fill: var(--bt-yellow, #eaae3f);
        }

        .radar-hover-node {
            fill: #62c4ff;
        }

        .radar-center {
            fill: rgba(255, 255, 255, 0.55);
        }

        .radar-label {
            fill: var(--text-color, #fff);
            font-size: 16px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .radar-label-value {
            fill: var(--text-color-secondary);
            font-size: 14px;
        }

        .radar-label-value-hover {
            fill: #62c4ff;
        }

        .radar-empty {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: var(--text-color-secondary);
            text-align: center;
        }

        @media (max-width: 700px) {
            .radar-label {
                font-size: 19px;
            }

            .radar-label-value {
                font-size: 17px;
            }
        }
    `],
})
export class LoadForceRadarPanelComponent {
    private readonly dataService = inject(DataService);

    readonly centerX = RADAR_CENTER_X;
    readonly centerY = RADAR_CENTER_Y;
    readonly viewBoxWidth = RADAR_VIEWBOX_WIDTH;
    readonly viewBoxHeight = RADAR_VIEWBOX_HEIGHT;
    readonly force = input.required<LoadForceEntry>();
    readonly hoveredUnit = input<Unit | null>(null);
    readonly axisDefinitions = computed(() => this.force().type === GameSystem.ALPHA_STRIKE
        ? ALPHA_STRIKE_RADAR_AXIS_DEFINITIONS
        : CLASSIC_RADAR_AXIS_DEFINITIONS);

    readonly units = computed(() => this.force().groups
        .flatMap((group) => group.units)
        .map((entry) => entry.unit)
        .filter((unit): unit is Unit => unit !== undefined));

    readonly hasUnits = computed(() => this.units().length > 0);

    readonly chartAxes = computed<RadarAxis[]>(() => {
        const axisDefinitions = this.axisDefinitions();
        const gameSystem = this.force().type;
        const totals = axisDefinitions.map((definition, index) => ({
            definition,
            index,
            value: 0,
            min: 0,
            average: 0,
            max: 0,
        }));

        for (const unit of this.units()) {
            const maxStats = gameSystem === GameSystem.ALPHA_STRIKE
                ? this.dataService.getASUnitTypeMaxStats(unit.as?.TP ?? '')
                : this.dataService.getUnitSubtypeMaxStats(unit.subtype);

            for (const total of totals) {
                const contribution = total.definition.getContribution(unit, maxStats);
                total.value += contribution.value;
                total.min += contribution.min;
                total.average += contribution.average;
                total.max += contribution.max;
            }
        }

        return totals.map((total) => {
            return buildRadarAxis(total.definition, total.index, axisDefinitions.length, {
                value: total.value,
                min: total.min,
                average: total.average,
                max: total.max,
            });
        });
    });

    readonly hoveredUnitAxes = computed<RadarAxis[]>(() => {
        const hoveredUnit = this.hoveredUnit();
        if (!hoveredUnit) {
            return [];
        }

        const axisDefinitions = this.axisDefinitions();
        const maxStats = this.getUnitBucketMaxStats(hoveredUnit);

        return axisDefinitions.map((definition, index) => buildRadarAxis(
            definition,
            index,
            axisDefinitions.length,
            definition.getContribution(hoveredUnit, maxStats),
        ));
    });

    readonly hoveredAxisMap = computed(() => {
        return new Map(this.hoveredUnitAxes().map((axis) => [axis.key, axis] as const));
    });

    readonly gridPolygonPoints = computed(() => {
        const axisDefinitions = this.axisDefinitions();
        return RADAR_RING_FACTORS.map((factor) => toPointString(
            axisDefinitions.map((_, index) => toPoint(getAngle(index, axisDefinitions.length), RADAR_RADIUS * factor)),
        ));
    });

    readonly valuePolygonPoints = computed(() => {
        return toPointString(this.chartAxes().map((axis) => axis.dataPoint));
    });

    readonly hoveredValuePolygonPoints = computed(() => {
        return toPointString(this.hoveredUnitAxes().map((axis) => axis.dataPoint));
    });

    private getUnitBucketMaxStats(unit: Unit): MinMaxStatsRange {
        return getUnitBucketMaxStats(this.dataService, this.force().type, unit);
    }
}