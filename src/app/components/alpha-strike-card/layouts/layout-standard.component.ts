import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SpecialAbilityState } from '../../../models/as-special-ability-state.model';
import { formatMovement, isAerospace } from '../../../utils/as-common.util';
import type { CriticalHitsVariant } from '../card-layout.config';
import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';
import { AsLayoutBaseComponent } from './layout-base.component';
import {
    STANDARD_CARD_GEOMETRY,
    buildStandardLayout,
    estimateRobotoCondensedWidth,
    getStandardCriticalRows,
    wrapSvgTokenLines,
    type StandardCriticalVariant,
} from './standard-layout.model';

@Component({
    selector: 'g[as-layout-standard]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './layout-standard.component.html',
    styleUrl: '../alpha-strike-card-svg.component.scss',
    host: {
        '[class.interactive]': 'interactive()',
        '[class.night-mode]': 'cardStyle() === "night"',
    },
})
export class AsLayoutStandardComponent extends AsLayoutBaseComponent {
    readonly instanceId = input.required<number>();
    readonly criticalVariant = input.required<CriticalHitsVariant>();
    readonly cardGeometry = CARD_LAYOUT_GEOMETRY;
    readonly standardGeometry = STANDARD_CARD_GEOMETRY;

    private readonly specialsText = computed(() => {
        const values = this.effectiveSpecials().map(item => item.effective).join(', ');
        return values ? `SPECIAL: ${values}` : '';
    });

    readonly specialLines = computed(() => {
        const states = this.effectiveSpecials();
        const tokens = states.map((state, index) => {
            const remaining = state.maxCount && state.consumedCount
                ? `[${state.maxCount - state.consumedCount}]`
                : '';
            return {
                state,
                text: `${state.effective}${remaining}${index < states.length - 1 ? ',' : ''}`,
            };
        });
        return wrapSvgTokenLines(
            tokens,
            token => `${token.text} `,
            CARD_LAYOUT_GEOMETRY.bodyWidth - STANDARD_CARD_GEOMETRY.specialsPaddingX * 2,
            STANDARD_CARD_GEOMETRY.specialsFontSize,
            'SPECIAL: ',
        );
    });

    readonly standardLayout = computed(() => buildStandardLayout({
        specialsText: this.specialsText(),
        specialsLineCount: this.specialLines().length,
        usesHeat: this.asStats().usesOV,
        hasCriticalTable: this.criticalVariant() !== 'none',
        armorPips: this.armorPips(),
        structurePips: this.structurePips(),
        criticalRowCount: this.criticalRows().length,
        hasCriticalMotiveRow: this.criticalVariant() === 'vehicle',
    }));

    readonly standardImageGeometry = computed(() => {
        const variant = this.criticalVariant();
        const centered = variant !== 'mek';
        const reduced = variant === 'vehicle' || variant === 'aerofighter';
        return {
            x: 640,
            y: centered ? 144 : 112,
            width: 410,
            height: reduced ? 280 : 470,
            preserveAspectRatio: centered ? 'xMidYMid meet' : 'xMidYMin meet',
        };
    });

    readonly sprintMove = computed<string | null>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return null;
        const groundEntries = this.getMovementEntries(forceUnit.effectiveMovement())
            .filter(([mode]) => mode !== 'j');
        if (groundEntries.length === 0) return null;
        const defaultGround = groundEntries.find(([mode]) => mode === '') ?? groundEntries[0];
        return formatMovement(Math.ceil(defaultGround[1] * 1.5), '', this.useHex());
    });

    readonly tmmDisplay = computed(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return String(this.asStats().TMM ?? '');
        const isBattleMek = this.asStats().TP === 'BM';
        return Object.entries(forceUnit.effectiveTmm())
            .filter(([mode]) => !isBattleMek || (mode !== 'a' && mode !== 'g'))
            .map(([mode, value]) => `${value}${mode}`)
            .join('/');
    });

    readonly isAerospaceUnit = computed(() => isAerospace(this.asStats().TP, this.asStats().MVm));
    readonly pendingHeat = computed(() => this.forceUnit()?.getState().pendingHeat() ?? 0);
    readonly heatTrackLevels = computed(() => this.forceUnit()?.heatTrackLevels('committed') ?? [0, 1, 2, 3]);
    readonly shutdownHeatThreshold = computed(() => this.forceUnit()?.shutdownHeatThreshold('committed') ?? 4);
    readonly effectiveDamageS = computed(() => this.forceUnit()?.effectiveDamageS() ?? this.asStats().dmg.dmgS);
    readonly effectiveDamageM = computed(() => this.forceUnit()?.effectiveDamageM() ?? this.asStats().dmg.dmgM);
    readonly effectiveDamageL = computed(() => this.forceUnit()?.effectiveDamageL() ?? this.asStats().dmg.dmgL);
    readonly effectiveDamageE = computed(() => this.forceUnit()?.effectiveDamageE() ?? this.asStats().dmg.dmgE);
    readonly rangeShort = computed(() => this.useHex() ? '0~3' : '0″~6″');
    readonly rangeMedium = computed(() => this.useHex() ? '4~12' : '>6″~24″');
    readonly rangeLong = computed(() => this.useHex() ? '13~21' : '>24″~42″');
    readonly rangeExtreme = computed(() => this.useHex() ? '22+' : '>42″');
    readonly movementSvgText = computed(() => this.movementDisplay().replace(/<[^>]*>/g, ''));

    readonly damageRanges = computed(() => {
        const ranges = [
            { label: 'S', modifier: 0, toHit: this.toHitShort(), value: this.effectiveDamageS(), distance: this.rangeShort() },
            { label: 'M', modifier: 2, toHit: this.toHitMedium(), value: this.effectiveDamageM(), distance: this.rangeMedium() },
            { label: 'L', modifier: 4, toHit: this.toHitLong(), value: this.effectiveDamageL(), distance: this.rangeLong() },
        ];
        if (this.hasExtremeRange()) {
            ranges.push({ label: 'E', modifier: 6, toHit: this.toHitExtreme(), value: this.effectiveDamageE(), distance: this.rangeExtreme() });
        }
        return ranges;
    });

    readonly headerLines = computed(() => {
        const alias = this.forceUnit()?.alias();
        const modelLine = alias ? `${this.chassis()} ${this.model()}`.trim() : this.model();
        const chassisLine = alias || this.chassis();
        const maxWidth = 690;
        const preferredSize = chassisLine.length > 20 ? 60 : 70;
        const measured = estimateRobotoCondensedWidth(chassisLine.toUpperCase(), preferredSize);
        const fontSize = measured > maxWidth ? Math.max(42, Math.floor(preferredSize * maxWidth / measured)) : preferredSize;
        return { model: modelLine.toUpperCase(), chassis: chassisLine.toUpperCase(), fontSize };
    });

    readonly criticalRows = computed(() => getStandardCriticalRows(this.criticalVariant() as StandardCriticalVariant));

    committedCritHits(key: string): number {
        return this.forceUnit()?.getState().getCommittedCritHits(key) ?? 0;
    }

    pendingCritChange(key: string): number {
        return this.forceUnit()?.getState().getPendingCritChange(key) ?? 0;
    }

    showNumericCritPips(key: string, maxPips: number): boolean {
        return this.committedCritHits(key) + Math.max(0, this.pendingCritChange(key)) > maxPips;
    }

    pendingCritDelta(key: string): string {
        const pending = this.pendingCritChange(key);
        return pending > 0 ? `+${pending}` : String(pending);
    }

    armorPipX(index: number, frameX: number): number {
        return frameX + 68 + (index % STANDARD_CARD_GEOMETRY.pipColumns) * STANDARD_CARD_GEOMETRY.pipColumnWidth;
    }

    armorPipY(index: number, frameY: number): number {
        return frameY + STANDARD_CARD_GEOMETRY.pipFirstRowOffset
            + this.pipRow(index) * STANDARD_CARD_GEOMETRY.pipRowHeight;
    }

    structurePipY(index: number, frameY: number): number {
        const armorRows = Math.max(1, Math.ceil(this.armorPips() / STANDARD_CARD_GEOMETRY.pipColumns));
        return frameY + STANDARD_CARD_GEOMETRY.pipFirstRowOffset
            + (armorRows + this.pipRow(index)) * STANDARD_CARD_GEOMETRY.pipRowHeight;
    }

    armorHitAreaHeight(frameY: number): number {
        return this.damagePipRowsBoundary(frameY) - frameY;
    }

    structureHitAreaY(frameY: number): number {
        return this.damagePipRowsBoundary(frameY);
    }

    damagePipHitAreaWidth(pipCount: number, frameWidth: number): number {
        const columns = Math.max(1, Math.min(pipCount, STANDARD_CARD_GEOMETRY.pipColumns));
        const contentWidth = 86 + (columns - 1) * STANDARD_CARD_GEOMETRY.pipColumnWidth;
        return Math.min(frameWidth - 4, contentWidth);
    }

    private damagePipRowsBoundary(frameY: number): number {
        const lastArmorIndex = Math.max(0, this.armorPips() - 1);
        return (this.armorPipY(lastArmorIndex, frameY) + this.structurePipY(0, frameY)) / 2;
    }

    private pipRow(index: number): number {
        return Math.floor(index / STANDARD_CARD_GEOMETRY.pipColumns);
    }
}