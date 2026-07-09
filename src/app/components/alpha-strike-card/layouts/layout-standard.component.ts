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
    estimateRobotoWidth,
    getStandardCriticalRows,
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

    private readonly specialsText = computed(() => {
        const values = this.effectiveSpecials().map(item => item.effective).join(', ');
        return values ? `SPECIAL: ${values}` : '';
    });

    readonly standardLayout = computed(() => buildStandardLayout({
        specialsText: this.specialsText(),
        usesHeat: this.asStats().usesOV,
        hasCriticalTable: this.criticalVariant() !== 'none',
        armorPips: this.armorPips(),
        structurePips: this.structurePips(),
        criticalHeight: this.criticalVariant() === 'vehicle' ? 228 : 218,
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

    readonly specialTokens = computed(() => {
        const frame = this.standardLayout().specials;
        if (!frame) return [];
        const fontSize = 30;
        const maxX = frame.x + frame.width - 14;
        const lineHeight = 34;
        let x = frame.x + 14 + estimateRobotoWidth('SPECIAL: ', fontSize);
        let line = 0;
        return this.effectiveSpecials().map((state, index, values) => {
            const remaining = state.maxCount && state.consumedCount
                ? `[${state.maxCount - state.consumedCount}]`
                : '';
            const text = `${state.effective}${remaining}${index < values.length - 1 ? ', ' : ''}`;
            const width = estimateRobotoWidth(text, fontSize);
            if (x + width > maxX && x > frame.x + 14) {
                line++;
                x = frame.x + 14;
            }
            const token = { state, text, x, y: frame.y + 10 + (line + 1) * lineHeight - 6 };
            x += width;
            return token;
        });
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

    private pipRow(index: number): number {
        return Math.floor(index / STANDARD_CARD_GEOMETRY.pipColumns);
    }
}