import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';
import { AsLayoutBaseComponent } from './layout-base.component';
import { VESSEL_REAR_GEOMETRY } from './vessel-layout.model';

interface VesselArcRenderModel {
    label: string;
    shortLabel: string;
    specials: string;
    rows: Array<{ label: string; values: string[] }>;
}

@Component({
    selector: 'g[as-layout-vessel-rear]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './layout-vessel-rear.component.html',
    styleUrl: '../alpha-strike-card-svg.component.scss',
    host: {
        '[class.interactive]': 'interactive()',
        '[class.night-mode]': 'cardStyle() === "night"',
    },
})
export class AsLayoutVesselRearComponent extends AsLayoutBaseComponent {
    readonly cardGeometry = CARD_LAYOUT_GEOMETRY;
    readonly vesselRearGeometry = VESSEL_REAR_GEOMETRY;
    readonly vesselHasCap = computed(() => ['WS', 'SS', 'JS'].includes(this.asStats().TP));
    readonly vesselArcColumns = computed(() => this.vesselHasCap()
        ? ['STD', 'CAP', 'SCAP', 'MSL']
        : ['STD', 'SCAP', 'MSL']);

    readonly vesselArcData = computed<VesselArcRenderModel[]>(() => {
        const stats = this.asStats();
        const definitions = [
            { label: 'NOSE ARC DAMAGE', shortLabel: 'NOSE', arc: stats.frontArc },
            { label: 'AFT ARC DAMAGE', shortLabel: 'AFT', arc: stats.rearArc },
            { label: 'LEFT SIDE DAMAGE', shortLabel: 'LS', arc: stats.leftArc },
            { label: 'RIGHT SIDE DAMAGE', shortLabel: 'RS', arc: stats.rightArc },
        ];
        const rangeDefinitions = [
            { label: `S (${this.toHitShort()}+)`, key: 'dmgS' as const },
            { label: `M (${this.toHitMedium()}+)`, key: 'dmgM' as const },
            { label: `L (${this.toHitLong()}+)`, key: 'dmgL' as const },
            { label: `E (${this.toHitExtreme()}+)`, key: 'dmgE' as const },
        ];

        return definitions.map(definition => ({
            label: definition.label,
            shortLabel: definition.shortLabel,
            specials: definition.arc?.specials ?? '',
            rows: rangeDefinitions.map(rangeDefinition => ({
                label: rangeDefinition.label,
                values: this.vesselArcColumns().map(column => {
                    const base = definition.arc?.[column as 'STD' | 'CAP' | 'SCAP' | 'MSL']?.[rangeDefinition.key];
                    const crits = this.committedCritHits(`${definition.shortLabel}-${column}`);
                    return this.applyVesselCritReduction(base, crits);
                }),
            })),
        }));
    });

    private committedCritHits(key: string): number {
        return this.forceUnit()?.getState().getCommittedCritHits(key) ?? 0;
    }

    private applyVesselCritReduction(value: string | undefined, critHits: number): string {
        const numericValue = Number.parseInt(value ?? '', 10);
        if (!Number.isFinite(numericValue) || numericValue === 0) return '—';
        const reductionFactor = 1 - Math.min(critHits, 4) * 0.25;
        return String(Math.max(0, Math.floor(numericValue * reductionFactor)));
    }
}