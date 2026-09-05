// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import { getForcePreviewResolvedUnits, type ForcePreviewEntry } from '../../models/force-preview.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { UnitSearchIndexService, type MinMaxStatsRange } from '../../services/unit-search-index.service';
import { getUnitStatValues } from '../../utils/unit-stat-values.util';
import { RadarHelpComponent } from './radar-help.component';

interface RadarPoint { x: number; y: number; }
interface RadarAxisDefinition { key: keyof MinMaxStatsRange; label: string; }
interface RadarAxis {
    key: keyof MinMaxStatsRange;
    label: string;
    value: number;
    max: number;
    available: boolean;
    ratio: number;
    comparisonText: string;
    axisPoint: RadarPoint;
    dataPoint: RadarPoint;
    labelPoint: RadarPoint;
    textAnchor: 'start' | 'middle' | 'end';
}
interface ForceRadarAxis extends RadarAxis { average: number; }

const CLASSIC_RADAR_AXIS_DEFINITIONS: readonly RadarAxisDefinition[] = [
    { key: 'mobility', label: 'Mobility' },
    { key: 'endurance', label: 'Endurance' },
    { key: 'weightedMaxRange', label: 'Range' },
    { key: 'dpt', label: 'Damage' },
];
const ALPHA_STRIKE_RADAR_AXIS_DEFINITIONS: readonly RadarAxisDefinition[] = [
    { key: 'asTmm', label: 'Mobility' },
    { key: 'asEndurance', label: 'Endurance' },
    { key: 'asDmgS', label: 'Damage (S)' },
    { key: 'asDmgM', label: 'Damage (M)' },
    { key: 'asDmgL', label: 'Damage (L)' },
];

const RADAR_VIEWBOX_WIDTH = 500;
const RADAR_VIEWBOX_HEIGHT = 400;
const RADAR_RENDER_WIDTH = 800;
const RADAR_RENDER_HEIGHT = 640;
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


function buildRadarAxis(
    definition: RadarAxisDefinition, index: number, axisCount: number,
    value: number, max: number, available: boolean,
): RadarAxis {
    const angle = getAngle(index, axisCount);
    const ratio = !available ? 0 : max > 0 ? value / max : value > 0 ? 1 : 0;
    const comparisonText = !available ? 'N/A'
        : max === 0 && value > 0 ? `${formatStatValue(value)} · rare`
        : `${formatStatValue(value)} / ${formatStatValue(max)}`
            + (ratio > 1 ? ` · ${Math.round(ratio * 100)}%` : '');
    const labelPoint = getLabelPoint(angle);
    return {
        ...definition, value, max, available, ratio, comparisonText,
        axisPoint: toPoint(angle, RADAR_RADIUS),
        dataPoint: toPoint(angle, RADAR_RADIUS * clamp(ratio, 0, 1)),
        labelPoint, textAnchor: getTextAnchor(labelPoint),
    };
}

@Component({
    selector: 'force-radar-panel',
    standalone: true,
    imports: [CommonModule, RadarHelpComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @let axes = chartAxes();
    @let overlayAxes = hoveredUnitAxes();
    @let overlayAxisMap = hoveredAxisMap();
    <div class="force-radar-shell">
        @if (hasUnits()) {
            <div class="radar-area">
                <radar-help />
                <svg
                    class="radar-chart"
                    [attr.viewBox]="'0 0 ' + viewBoxWidth + ' ' + viewBoxHeight"
                    [attr.width]="renderWidth"
                    [attr.height]="renderHeight"
                    preserveAspectRatio="xMidYMid meet"
                    role="img" aria-label="Force capabilities compared with the catalog p95 reference">
                    <title>Force values / p95 reference for this unit composition. The gray dotted outline shows the catalog average for the force composition. The blue dashed outline compares the hovered unit with its own type and superheavy bucket, not the whole force. Use the help button for a visual guide.</title>

                    @for (ring of gridRings(); track ring.factor) {
                        <polygon
                            class="radar-ring"
                            [attr.points]="ring.points"></polygon>
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
                    <path class="radar-average-outline" [attr.d]="averagePath()">
                        <title>Catalog average for this force composition. Gaps indicate unavailable measurements or a positive average with a zero p95 reference.</title>
                    </path>

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
                                {{ axis.comparisonText }}
                            </text>
                            @if (overlayAxisMap.get(axis.key); as overlayAxis) {
                                <text class="radar-label-value radar-label-value-hover" [attr.text-anchor]="axis.textAnchor" y="32">
                                    {{ overlayAxis.comparisonText }}
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
            max-height: inherit;
            box-sizing: border-box;
            overflow: hidden;
        }

        .radar-area {
            position: relative;
            display: flex;
            justify-content: center;
            width: 100%;
            max-height: inherit;
            padding: 0 2px;
            box-sizing: border-box;
            overflow: hidden;
        }

        .radar-chart {
            display: block;
            width: auto;
            height: auto;
            max-width: 100%;
            max-height: inherit;
        }

        .radar-ring {
            fill: none;
            stroke: rgba(255, 255, 255, 0.14);
            stroke-width: 1;
        }

        .radar-average-outline {
            fill: none;
            stroke: #aaa;
            stroke-width: 2;
            stroke-dasharray: 1 5;
            stroke-linecap: round;
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
export class ForceRadarPanelComponent {
    private readonly searchIndex = inject(UnitSearchIndexService);

    readonly centerX = RADAR_CENTER_X;
    readonly centerY = RADAR_CENTER_Y;
    readonly viewBoxWidth = RADAR_VIEWBOX_WIDTH;
    readonly viewBoxHeight = RADAR_VIEWBOX_HEIGHT;
    readonly renderWidth = RADAR_RENDER_WIDTH;
    readonly renderHeight = RADAR_RENDER_HEIGHT;
    readonly force = input.required<ForcePreviewEntry>();
    readonly hoveredUnit = input<UnitSummary | null>(null);
    readonly axisDefinitions = computed(() => this.force().type === GameSystem.AS
        ? ALPHA_STRIKE_RADAR_AXIS_DEFINITIONS : CLASSIC_RADAR_AXIS_DEFINITIONS);
    readonly units = computed(() => getForcePreviewResolvedUnits(this.force()));
    readonly hasUnits = computed(() => this.units().length > 0);

    readonly chartAxes = computed<ForceRadarAxis[]>(() => {
        const definitions = this.axisDefinitions();
        const units = this.units().map(unit => ({
            values: getUnitStatValues(unit),
            stats: this.searchIndex.getUnitStats(unit),
        }));
        return definitions.map((definition, index) => {
            const key = definition.key;
            // Partial totals would compare different compositions, so mark the whole axis unavailable.
            const available = units.length > 0 && units.every(unit =>
                unit.values[key] !== null && unit.stats[key].count > 0);
            const value = units.reduce((sum, unit) => sum + (unit.values[key] ?? 0), 0);
            const benchmark = units.reduce((sum, unit) => sum + unit.stats[key].p95, 0);
            const average = units.reduce((sum, unit) => sum + unit.stats[key].average, 0);
            return { ...buildRadarAxis(definition, index, definitions.length, value, benchmark, available), average };
        });
    });

    readonly averageAxes = computed(() => this.chartAxes().map((axis, index, axes) =>
        buildRadarAxis(axis, index, axes.length, axis.average, axis.max,
            axis.available && (axis.max > 0 || axis.average === 0)),
    ));
    readonly averagePath = computed(() => {
        const axes = this.averageAxes();
        // Leave gaps rather than suggesting a zero average for unsupported or unscalable axes.
        return axes.map((axis, index) => {
            const next = axes[(index + 1) % axes.length];
            if (!axis.available || !next.available) return '';
            return `M${axis.dataPoint.x},${axis.dataPoint.y} L${next.dataPoint.x},${next.dataPoint.y}`;
        }).join(' ');
    });

    readonly hoveredUnitAxes = computed<RadarAxis[]>(() => {
        const unit = this.hoveredUnit();
        if (!unit) return [];
        const values = getUnitStatValues(unit);
        const stats = this.searchIndex.getUnitStats(unit);
        return this.axisDefinitions().map((axis, index, axes) => buildRadarAxis(
            axis, index, axes.length, values[axis.key] ?? 0, stats[axis.key].p95,
            values[axis.key] !== null && stats[axis.key].count > 0,
        ));
    });
    readonly hoveredAxisMap = computed(() => new Map(this.hoveredUnitAxes().map(axis => [axis.key, axis])));
    readonly gridRings = computed(() => RADAR_RING_FACTORS.map(factor => ({
        factor,
        points: toPointString(this.axisDefinitions().map((_, index, axes) =>
            toPoint(getAngle(index, axes.length), RADAR_RADIUS * factor))),
    })));
    readonly valuePolygonPoints = computed(() => toPointString(this.chartAxes().map(axis => axis.dataPoint)));
    readonly hoveredValuePolygonPoints = computed(() => toPointString(this.hoveredUnitAxes().map(axis => axis.dataPoint)));
}
