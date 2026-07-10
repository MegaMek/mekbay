import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CriticalHitsVariant } from '../card-layout.config';
import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';
import { AsLayoutBaseComponent } from './layout-base.component';
import {
    buildVesselSpecialsLayout,
    VESSEL_FRONT_GEOMETRY,
    VESSEL_SPECIALS_GEOMETRY,
} from './vessel-layout.model';
import { wrapSvgTokenLines } from './standard-layout.model';

@Component({
    selector: 'g[as-layout-vessel-front]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './layout-vessel-front.component.html',
    styleUrl: '../alpha-strike-card-svg.component.scss',
    host: {
        '[class.interactive]': 'interactive()',
        '[class.night-mode]': 'cardStyle() === "night"',
    },
})
export class AsLayoutVesselFrontComponent extends AsLayoutBaseComponent {
    readonly instanceId = input.required<number>();
    readonly criticalVariant = input.required<CriticalHitsVariant>();
    readonly cardGeometry = CARD_LAYOUT_GEOMETRY;
    readonly vesselFrontGeometry = VESSEL_FRONT_GEOMETRY;
    readonly vesselSpecialsGeometry = VESSEL_SPECIALS_GEOMETRY;
    readonly movementSvgText = computed(() => this.movementDisplay().replace(/<[^>]*>/g, ''));

    readonly vesselCriticalRows = computed(() => {
        const common = [
            { key: 'crew', name: 'CREW', maxPips: 2, descriptions: ['+2 Weapon To-Hit Each', '+2 Control Roll Each'] },
            { key: 'engine', name: 'ENGINE', maxPips: 3, descriptions: ['-25%/-50%/-100% THR'] },
            { key: 'fire-control', name: 'FIRE CONTROL', maxPips: 4, descriptions: ['+2 To-Hit Each'] },
        ];
        if (this.criticalVariant() === 'dropship-1') {
            return [
                ...common,
                { key: 'kf-boom', name: 'KF BOOM', maxPips: 1, descriptions: ['Cannot transport via JumpShip'] },
                { key: 'dock-collar', name: 'DOCK COLLAR', maxPips: 1, descriptions: ['Cannot dock'] },
                { key: 'thruster', name: 'THRUSTER', maxPips: 1, descriptions: ['-1 Thrust (THR)'] },
            ];
        }
        return [
            ...common,
            { key: 'thruster', name: 'THRUSTER', maxPips: 1, descriptions: ['-1 Thrust (THR)'] },
        ];
    });

    readonly vesselSpecialsRenderModel = computed(() => {
        const fontSize = 30;
        const states = this.effectiveSpecials();
        const tokens = states.map((state, index) => {
            return { state, text: `${state.effective}${index < states.length - 1 ? ',' : ''}` };
        });
        const lines = wrapSvgTokenLines(
            tokens,
            token => `${token.text} `,
            VESSEL_SPECIALS_GEOMETRY.width - 28,
            fontSize,
            'SPECIAL: ',
        );
        const layout = buildVesselSpecialsLayout(lines.length);
        return {
            ...layout,
            lines,
        };
    });
}