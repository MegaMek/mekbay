import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { DataService, DOES_NOT_TRACK, type MinMaxStatsRange } from '../../services/data.service';

type RadarStatKey =
    | 'armor'
    | 'internal'
    | 'firepower'
    | 'dpt'
    | 'mobility'
    | 'endurance'
    | 'shortRangeDamage'
    | 'mediumRangeDamage'
    | 'longRangeDamage';

interface RadarContribution {
    value: number;
    min: number;
    max: number;
}

interface RadarPoint {
    x: number;
    y: number;
}

interface RadarAxisDefinition {
    key: RadarStatKey;
    label: string;
    getContribution: (unit: Unit, maxStats: MinMaxStatsRange) => RadarContribution;
}

interface RadarAxis {
    key: RadarStatKey;
    label: string;
    angle: number;
    value: number;
    min: number;
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
        getContribution: (unit, maxStats) => getMobilityContribution(unit, maxStats),
    },
    {
        key: 'endurance',
        label: 'Endurance',
        getContribution: (unit, maxStats) => ({
            value: sanitizeStatValue(unit.armor) + sanitizeStatValue(unit.internal),
            min: sanitizeStatValue(maxStats.armor[0]) + sanitizeStatValue(maxStats.internal[0]),
            max: sanitizeStatValue(maxStats.armor[1]) + sanitizeStatValue(maxStats.internal[1]),
        }),
    },
    {
        key: 'firepower',
        label: 'Firepower',
        getContribution: (unit, maxStats) => ({
            value: sanitizeStatValue(unit._mdSumNoPhysical),
            min: sanitizeStatValue(maxStats.alphaNoPhysicalNoOneshots[0]),
            max: sanitizeStatValue(maxStats.alphaNoPhysicalNoOneshots[1]),
        }),
    },
    {
        key: 'dpt',
        label: 'Damage/Turn',
        getContribution: (unit, maxStats) => ({
            value: sanitizeStatValue(unit.dpt),
            min: sanitizeStatValue(maxStats.dpt[0]),
            max: sanitizeStatValue(maxStats.dpt[1]),
        }),
    },
] as const;

const ALPHA_STRIKE_RADAR_AXIS_DEFINITIONS: readonly RadarAxisDefinition[] = [
    {
        key: 'mobility',
        label: 'Mobility',
        getContribution: (unit, maxStats) => ({
            value: sanitizeStatValue(unit.as?.TMM),
            min: sanitizeStatValue(maxStats.asTmm[0]),
            max: sanitizeStatValue(maxStats.asTmm[1]),
        }),
    },
    {
        key: 'endurance',
        label: 'Endurance',
        getContribution: (unit, maxStats) => ({
            value: sanitizeStatValue(unit.as?.Arm) + sanitizeStatValue(unit.as?.Str),
            min: sanitizeStatValue(maxStats.asArm[0]) + sanitizeStatValue(maxStats.asStr[0]),
            max: sanitizeStatValue(maxStats.asArm[1]) + sanitizeStatValue(maxStats.asStr[1]),
        }),
    },
    {
        key: 'shortRangeDamage',
        label: 'Damage (S)',
        getContribution: (unit, maxStats) => ({
            value: getASDamageValue(unit.as?.dmg._dmgS, unit.as?.dmg.dmgS),
            min: sanitizeStatValue(maxStats.asDmgS[0]),
            max: sanitizeStatValue(maxStats.asDmgS[1]),
        }),
    },
    {
        key: 'mediumRangeDamage',
        label: 'Damage (M)',
        getContribution: (unit, maxStats) => ({
            value: getASDamageValue(unit.as?.dmg._dmgM, unit.as?.dmg.dmgM),
            min: sanitizeStatValue(maxStats.asDmgM[0]),
            max: sanitizeStatValue(maxStats.asDmgM[1]),
        }),
    },
    {
        key: 'longRangeDamage',
        label: 'Damage (L)',
        getContribution: (unit, maxStats) => ({
            value: getASDamageValue(unit.as?.dmg._dmgL, unit.as?.dmg.dmgL),
            min: sanitizeStatValue(maxStats.asDmgL[0]),
            max: sanitizeStatValue(maxStats.asDmgL[1]),
        }),
    },
] as const;

const RADAR_VIEWBOX_SIZE = 440;
const RADAR_CENTER = RADAR_VIEWBOX_SIZE / 2;
const RADAR_RADIUS = 158;
const RADAR_LABEL_RADIUS = 182;
const RADAR_LABEL_SAFE_X = 58;
const RADAR_LABEL_SAFE_TOP = 22;
const RADAR_LABEL_SAFE_BOTTOM = 34;
const RADAR_RING_FACTORS = [0.25, 0.5, 0.75, 1] as const;
const RADAR_FALLBACK_RENDER_SIZE = 320;

function roundCoordinate(value: number): number {
    return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function toPoint(angleDegrees: number, distance: number): RadarPoint {
    const radians = angleDegrees * Math.PI / 180;
    return {
        x: roundCoordinate(RADAR_CENTER + Math.cos(radians) * distance),
        y: roundCoordinate(RADAR_CENTER + Math.sin(radians) * distance),
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
        x: roundCoordinate(clamp(point.x, RADAR_LABEL_SAFE_X, RADAR_VIEWBOX_SIZE - RADAR_LABEL_SAFE_X)),
        y: roundCoordinate(clamp(point.y, RADAR_LABEL_SAFE_TOP, RADAR_VIEWBOX_SIZE - RADAR_LABEL_SAFE_BOTTOM)),
    };
}

function sanitizeStatValue(value: number | undefined | null): number {
    if (value === undefined || value === null || !Number.isFinite(value) || value === DOES_NOT_TRACK) {
        return 0;
    }

    return Math.max(0, value);
}

function getMobilityContribution(unit: Unit, maxStats: MinMaxStatsRange): RadarContribution {
    const runValue = sanitizeStatValue(unit.run2);
    const jumpValue = sanitizeStatValue(unit.jump);
    const runMin = sanitizeStatValue(maxStats.run2MP[0]);
    const jumpMin = sanitizeStatValue(maxStats.jumpMP[0]);
    const runMax = sanitizeStatValue(maxStats.run2MP[1]);
    const jumpMax = sanitizeStatValue(maxStats.jumpMP[1]);

    if (runValue > jumpValue) {
        return { value: runValue, min: runMin, max: runMax };
    }

    if (jumpValue > runValue) {
        return { value: jumpValue, min: jumpMin, max: jumpMax };
    }

    return {
        value: runValue,
        min: Math.min(runMin, jumpMin),
        max: Math.min(runMax, jumpMax),
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

function getRadarRatio(value: number, min: number, max: number): number {
    if (max > min) {
        return clamp((value - min) / (max - min), 0, 1);
    }

    return value > 0 ? 1 : 0;
}

function buildRadarAxis(
    definition: RadarAxisDefinition,
    index: number,
    axisCount: number,
    contribution: RadarContribution,
): RadarAxis {
    const angle = getAngle(index, axisCount);
    const ratio = getRadarRatio(contribution.value, contribution.min, contribution.max);
    const labelPoint = getLabelPoint(angle);

    return {
        key: definition.key,
        label: definition.label,
        angle,
        value: contribution.value,
        min: contribution.min,
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
    <div class="force-radar-shell">
        @if (hasUnits()) {
            <div class="radar-area" #radarArea>
                <svg
                    class="radar-chart"
                    [attr.viewBox]="'0 0 ' + viewBoxSize + ' ' + viewBoxSize"
                    [style.width.px]="chartRenderSize()"
                    [style.height.px]="chartRenderSize()"
                    preserveAspectRatio="xMidYMid meet"
                    role="img">

                    @for (ringPoints of gridPolygonPoints(); track $index) {
                        <polygon class="radar-ring" [attr.points]="ringPoints"></polygon>
                    }

                    @for (axis of axes; track axis.key) {
                        <line
                            class="radar-axis"
                            [attr.x1]="center"
                            [attr.y1]="center"
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

                    <circle class="radar-center" [attr.cx]="center" [attr.cy]="center" r="2.5"></circle>

                    @for (axis of axes; track axis.key) {
                        <g
                            class="radar-label-group"
                            [attr.transform]="'translate(' + axis.labelPoint.x + ' ' + axis.labelPoint.y + ')'">
                            <text class="radar-label" [attr.text-anchor]="axis.textAnchor">{{ axis.label }}</text>
                            <text class="radar-label-value" [attr.text-anchor]="axis.textAnchor" y="14">
                                {{ axis.valueText }}/{{ axis.maxText }}
                            </text>
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
            min-height: var(--radar-panel-min-height, 280px);
        }

        .force-radar-shell {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            min-height: inherit;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, #333);
            box-sizing: border-box;
            overflow: hidden;
        }

        .radar-area {
            flex: 1 1 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: calc(var(--radar-panel-min-height, 280px) - 20px);
            padding: 0 2px;
            overflow: hidden;
        }

        .radar-chart {
            display: block;
            max-width: 100%;
            max-height: 100%;
            flex: 0 0 auto;
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
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .radar-label-value {
            fill: var(--text-color-secondary);
            font-size: 13px;
        }

        .radar-empty {
            min-height: calc(var(--radar-panel-min-height, 280px) - 20px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: var(--text-color-secondary);
            text-align: center;
        }

        @media (max-width: 700px) {
            :host {
                min-height: var(--radar-panel-min-height-mobile, 250px);
            }

            .radar-label {
                font-size: 18px;
            }

            .radar-label-value {
                fill: var(--text-color-secondary);
                font-size: 15px;
            }
        }

        @media (max-width: 520px) {
            :host {
                min-height: var(--radar-panel-min-height-mobile, 230px);
            }
        }
    `],
})
export class LoadForceRadarPanelComponent {
    private readonly dataService = inject(DataService);
    private readonly radarArea = viewChild<ElementRef<HTMLDivElement>>('radarArea');
    private readonly chartPixelSize = signal(RADAR_FALLBACK_RENDER_SIZE);

    readonly center = RADAR_CENTER;
    readonly viewBoxSize = RADAR_VIEWBOX_SIZE;
    readonly force = input.required<LoadForceEntry>();
    readonly hoveredUnit = input<Unit | null>(null);
    readonly axisDefinitions = computed(() => this.force().type === GameSystem.ALPHA_STRIKE
        ? ALPHA_STRIKE_RADAR_AXIS_DEFINITIONS
        : CLASSIC_RADAR_AXIS_DEFINITIONS);
    readonly chartRenderSize = computed(() => this.chartPixelSize());

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
                total.max += contribution.max;
            }
        }

        return totals.map((total) => {
            return buildRadarAxis(total.definition, total.index, axisDefinitions.length, {
                value: total.value,
                min: total.min,
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

    constructor() {
        effect((onCleanup) => {
            const radarArea = this.radarArea()?.nativeElement;
            if (!radarArea) {
                return;
            }

            const updateChartSize = (width: number, height: number): void => {
                const nextSize = Math.floor(Math.max(0, Math.min(width, height)));
                if (nextSize > 0) {
                    this.chartPixelSize.set(nextSize);
                }
            };

            updateChartSize(radarArea.clientWidth, radarArea.clientHeight);

            if (typeof ResizeObserver === 'undefined') {
                return;
            }

            const observer = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (entry) {
                    updateChartSize(entry.contentRect.width, entry.contentRect.height);
                }
            });

            observer.observe(radarArea);

            onCleanup(() => {
                observer.disconnect();
            });
        });
    }

    private getUnitBucketMaxStats(unit: Unit): MinMaxStatsRange {
        return getUnitBucketMaxStats(this.dataService, this.force().type, unit);
    }
}