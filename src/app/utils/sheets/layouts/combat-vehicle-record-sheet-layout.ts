// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { isVehicleEntity } from '../../../models/entity/utils/entity-type-guards';
import { clusterTableForEntity } from '../../record-sheet-reference-table';
import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    drawClusterHitsReference,
    drawGeneratedFooter,
    formatNumber,
    scaleCompactBox,
    setAttributes,
    svgElement,
} from '../record-sheet-svg-rendering';
import { CompactRecordSheetLayout } from './record-sheet-layout';
import {
    drawCompactVehicleChrome,
    drawCompactVehicleCrewPanel,
    drawCompactVehicleCriticalPanel,
    drawCompactVehicleDataPanel,
    drawCompactVehicleDiagram,
} from './vehicle-record-sheet-components';
import { drawVehicleReferenceTables } from './vehicle-record-sheet-reference-tables';
import { drawVtolReferenceTables } from './vtol-record-sheet-reference-tables';
import { appendRecordSheetEraIcon } from '../record-sheet-embedded-art';
import { isNavalRecordSheetEntity } from './naval-record-sheet-layout';

type CombatVehiclePaperdollFamily = 'vehicle' | 'vtol' | 'wige';

/** Tank, VTOL, and WiGE composition; motive type selects the paperdoll. */
export class CombatVehicleRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super(
            'combat-vehicle',
            'vehicle',
            'COMBAT VEHICLE RECORD SHEET',
            page => page.format === 'a4'
                ? { height: 400, stride: 403 }
                : { height: 375, stride: 378 },
        );
    }

    public matches(entity: BaseEntity): boolean {
        return isVehicleEntity(entity) && !isNavalRecordSheetEntity(entity);
    }

    protected override drawPrintablePageChrome(): void {
        // Vehicle compact blocks contain the MegaMekLab-style page masthead.
    }

    protected override printablePageContentY(profile: RecordSheetPageProfile): number {
        return profile.margin;
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[],
    ): void {
        if (blocks.length === 1) {
            const family = blocks[0].getAttribute('data-mekbay-vehicle-family');
            if (family === 'vtol') drawVtolReferenceTables(page, profile);
            else drawVehicleReferenceTables(page, profile);
        }
        drawGeneratedFooter(page, profile);
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        if (!this.matches(entity)) throw new Error('Combat-vehicle layout received an unsupported entity');
        const at = (box: Box): Box => scaleCompactBox(svg, box, 375);
        const family = this.paperdollFamily(entity);
        const airborne = family === 'vtol';
        svg.setAttribute('data-mekbay-vehicle-family', family);
        drawCompactVehicleChrome(svg, this.sheetTitle(entity));
        const dataBox = at({ x: 0.966, y: 69.857, width: 220.4, height: 283 });
        const dataGroup = drawCompactVehicleDataPanel(
            svg,
            entity,
            dataBox,
            { includePhysicalAttacks: !airborne, lastDetailBaseline: 251.58 },
        );
        drawCompactVehicleCrewPanel(
            svg,
            at({ x: 230.4, y: 69.857, width: 145.6, height: 91 }),
            { airborne },
        );
        drawCompactVehicleCriticalPanel(
            svg,
            entity,
            at({ x: 230.4, y: 164.905, width: 145.6, height: 91 }),
            airborne,
        );
        const clusterRacks = clusterTableForEntity(entity).clusterSizes;
        if (clusterRacks.length > 0) {
            drawClusterHitsReference(
                svg,
                at({ x: 230.4, y: 259.952, width: 154.6, height: 96.048 }),
                clusterRacks,
            );
        } else {
            addFrame(svg, 'NOTES', at({ x: 230.4, y: 260, width: 145.6, height: 93 }));
        }
        const dataContent = dataGroup.querySelector<SVGGElement>('.compact-vehicle-data-content') ?? dataGroup;
        await appendRecordSheetEraIcon(svg, dataContent, entity.year(), {
            x: 158.563 * dataBox.width / 220.4,
            y: 260 * dataBox.height / 283,
            width: 20 * dataBox.width / 220.4,
            height: 20 * dataBox.height / 283,
        });
        const diagramBox = at({ x: 387, y: 3, width: 189, height: 350 });
        const diagram = await drawCompactVehicleDiagram(
            svg,
            entity,
            diagramBox,
            {
                assetUrl: this.paperdollAsset(entity, family),
                motiveArtId: this.motiveArtId(entity, family),
            },
        );
        this.drawDiagramLabels(diagram, entity, diagramBox, family);
    }

    private paperdollFamily(entity: BaseEntity): CombatVehiclePaperdollFamily {
        const motive = `${entity.entityType} ${entity.getMotiveTypeAsString() ?? ''}`.toLowerCase();
        if (motive.includes('vtol')) return 'vtol';
        if (motive.includes('wige')) return 'wige';
        return 'vehicle';
    }

    private sheetTitle(entity: BaseEntity): string {
        if (!isVehicleEntity(entity)) return 'COMBAT VEHICLE RECORD SHEET';
        const motive = (entity.getMotiveTypeAsString() || 'Combat').trim().toUpperCase();
        const title: string[] = [];
        if (entity.isSupportVehicle()) {
            title.push(entity.weightClass().replace(/\s.*$/u, '').toUpperCase());
        } else if (entity.isSuperHeavy()) {
            title.push('SUPER-HEAVY');
        }
        if (motive !== 'VTOL') title.push(motive);
        if (entity.isSupportVehicle()) title.push('SUPPORT');
        if (motive === 'VTOL') title.push('V.T.O.L.');
        title.push(`${entity.omni() ? 'OMNI' : ''}VEHICLE`, 'RECORD', 'SHEET');
        return title.join(' ');
    }

    private paperdollAsset(entity: BaseEntity, family: CombatVehiclePaperdollFamily): string {
        const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
        const turret = dualTurret || isVehicleEntity(entity) && entity.hasTurret();
        const turretKind = dualTurret && family !== 'vtol' ? 'dualturret' : turret ? 'turret' : 'noturret';
        const superheavy = isVehicleEntity(entity)
            && entity.isSuperHeavy()
            && family !== 'vtol'
            && family !== 'wige';
        return `/images/paperdolls/${family}-${superheavy ? 'superheavy-' : ''}${turretKind}.svg`;
    }

    private motiveArtId(
        entity: BaseEntity,
        family: CombatVehiclePaperdollFamily,
    ): 'tracks' | 'wheels' | 'hovercraft' | undefined {
        if (family !== 'vehicle') return undefined;
        const motive = (entity.getMotiveTypeAsString() ?? '').toLowerCase();
        if (motive.includes('tracked')) return 'tracks';
        if (motive.includes('wheeled')) return 'wheels';
        if (motive.includes('hover')) return 'hovercraft';
        return undefined;
    }

    private drawDiagramLabels(
        group: SVGGElement,
        entity: BaseEntity,
        box: Box,
        family: CombatVehiclePaperdollFamily,
    ): void {
        if (family === 'vtol') {
            this.drawVtolDiagramLabels(group, entity, box);
            return;
        }
        if (family === 'wige') {
            this.drawWigeDiagramLabels(group, entity, box);
            return;
        }
        this.drawGroundVehicleDiagramLabels(group, entity, box);
    }

    /** Exact MML ground-vehicle label transforms on the canonical 189×350 diagram. */
    private drawGroundVehicleDiagramLabels(
        group: SVGGElement,
        entity: BaseEntity,
        box: Box,
    ): void {
        const labels = svgElement('g');
        labels.setAttribute('class', 'combat-vehicle-diagram-labels ground-vehicle-diagram-labels');
        labels.setAttribute(
            'transform',
            `scale(${formatNumber(box.width / 189)} ${formatNumber(box.height / 350)})`,
        );
        const armor = this.armorValueReader(entity);

        const frontRear = svgElement('text');
        setAttributes(frontRear, {
            transform: 'matrix(1.126742 0 0 1.129 90.697086 25.067548)',
            'font-family': 'Roboto',
            'font-size': 7.74,
            'font-weight': 600,
            'text-anchor': 'middle',
        });
        this.appendLabelTspan(frontRear, 'Front Armor', 0, 12);
        this.appendLabelTspan(frontRear, `( ${armor('FR', 'F')} )`, 0, 21.275);
        this.appendLabelTspan(frontRear, 'Rear Armor', 0, 269.91);
        this.appendLabelTspan(frontRear, `( ${armor('RR', 'R')} )`, 0, 279.185);
        labels.appendChild(frontRear);

        this.appendVerticalArmorLabel(
            labels,
            'Left Side Armor',
            armor('LS', 'L'),
            'matrix(0 -1.126742 1.129 0 6.926415 235.705078)',
            63.083,
            60.388,
        );
        this.appendVerticalArmorLabel(
            labels,
            'Right Side Armor',
            armor('RS', 'R'),
            'matrix(0 1.126742 -1.129 0 183.127187 137.968677)',
            68.285,
            65.591,
        );

        const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
        const turret = armor('TU', 'T1', 'T');
        if (!dualTurret && turret > 0) {
            const turretText = svgElement('text');
            setAttributes(turretText, {
                transform: 'matrix(1.126742 0 0 1.129 68.751584 158.858564)',
                'font-family': 'Roboto',
                'font-size': 6.77,
                'font-weight': 600,
            });
            this.appendLabelTspan(turretText, 'Turret Armor', 0, 0);
            this.appendLabelTspan(turretText, `( ${turret} )`, 0, 8.116);
            labels.appendChild(turretText);
        }
        if (dualTurret) this.appendDualTurretArmorLabels(labels, armor('FT'), armor('RT'));
        group.appendChild(labels);
    }

    /** MML's superheavy dual-turret template places these outside the hull. */
    private appendDualTurretArmorLabels(
        parent: SVGElement,
        frontArmor: number,
        rearArmor: number,
    ): void {
        const rear = svgElement('text');
        setAttributes(rear, {
            transform: 'translate(17.3 348.437)',
            'font-family': 'Roboto',
            'font-size': 8.0431,
            'font-weight': 700,
        });
        this.appendLabelTspan(rear, 'Rear', 0, 0);
        this.appendLabelTspan(rear, 'Turret Armor', 0, 8.431);
        this.appendLabelTspan(rear, `( ${rearArmor} )`, 50.58, 8.431).id = 'textArmor_RT';
        parent.appendChild(rear);

        const front = svgElement('text');
        setAttributes(front, {
            transform: 'translate(183.964 48.3)',
            'font-family': 'Roboto',
            'font-size': 8.0431,
            'font-weight': 700,
            'text-anchor': 'end',
        });
        this.appendLabelTspan(front, 'Front', 0, 2);
        this.appendLabelTspan(front, 'Turret Armor', 0, 10.431);
        this.appendLabelTspan(front, `( ${frontArmor} )`, 0, 18.862).id = 'textArmor_FT';
        parent.appendChild(front);
    }

    private drawVtolDiagramLabels(group: SVGGElement, entity: BaseEntity, box: Box): void {
        const labels = svgElement('g');
        labels.setAttribute('class', 'combat-vehicle-diagram-labels vtol-diagram-labels');
        labels.setAttribute(
            'transform',
            `scale(${formatNumber(box.width / 189)} ${formatNumber(box.height / 350)})`,
        );
        const armor = this.armorValueReader(entity);
        const frontRear = svgElement('text');
        setAttributes(frontRear, {
            transform: 'matrix(1.063 0 0 1.063 96.571424 41.321677)',
            'font-family': 'Roboto',
            'font-size': 7.74,
            'font-weight': 700,
            'text-anchor': 'middle',
        });
        this.appendLabelTspan(frontRear, 'Front Armor', 0, 0);
        this.appendLabelTspan(frontRear, `( ${armor('FR', 'F')} )`, 0, 9.275);
        this.appendLabelTspan(frontRear, 'Rear Armor', 0, 280.185);
        this.appendLabelTspan(frontRear, `( ${armor('RR', 'R')} )`, 0, 289.46);
        labels.appendChild(frontRear);

        this.appendVerticalArmorLabel(
            labels,
            'Left Side Armor',
            armor('LS', 'L'),
            'matrix(0 -1.063 1.063 0 28.56281 257.95151)',
            57.383,
        );
        this.appendVerticalArmorLabel(
            labels,
            'Right Side Armor',
            armor('RS', 'R'),
            'matrix(0 1.063 -1.063 0 158.723971 186.155427)',
            62.585,
        );

        const rotor = svgElement('text');
        setAttributes(rotor, {
            transform: 'matrix(1.063 0 0 1.063 163.55318 114.93549)',
            'font-family': 'Roboto',
            'font-size': 7.74,
            'font-weight': 700,
            'text-anchor': 'middle',
        });
        this.appendLabelTspan(rotor, 'Rotor', 0, 0);
        this.appendLabelTspan(rotor, 'Armor', 0, 8.116);
        this.appendLabelTspan(rotor, `( ${armor('RO', 'Rotor')} )`, 0, 16.232);
        labels.appendChild(rotor);
        group.appendChild(labels);
    }

    private drawWigeDiagramLabels(group: SVGGElement, entity: BaseEntity, box: Box): void {
        const labels = svgElement('g');
        labels.setAttribute('class', 'combat-vehicle-diagram-labels wige-diagram-labels');
        labels.setAttribute(
            'transform',
            `scale(${formatNumber(box.width / 189)} ${formatNumber(box.height / 350)})`,
        );
        const armor = this.armorValueReader(entity);
        const frontRear = svgElement('text');
        setAttributes(frontRear, {
            transform: 'matrix(1.036 0 0 1.036 93.221352 40.178744)',
            'font-family': 'Roboto',
            'font-size': 7.74,
            'font-weight': 600,
            'text-anchor': 'middle',
        });
        this.appendLabelTspan(frontRear, 'Front Armor', 0, 0);
        this.appendLabelTspan(frontRear, `( ${armor('FR', 'F')} )`, 0, 9.275);
        this.appendLabelTspan(frontRear, 'Rear Armor', 0, 267.81);
        this.appendLabelTspan(frontRear, `( ${armor('RR', 'R')} )`, 0, 277.085);
        labels.appendChild(frontRear);
        this.appendVerticalArmorLabel(
            labels,
            'Left Side Armor',
            armor('LS', 'L'),
            'matrix(0 -1.036 1.036 0 5.399632 238.054744)',
            56.783,
        );
        this.appendVerticalArmorLabel(
            labels,
            'Right Side Armor',
            armor('RS', 'R'),
            'matrix(0 1.036 -1.036 0 183.623748 161.437364)',
            61.185,
        );
        const turret = armor('TU', 'T1', 'T');
        if (turret > 0) {
            const turretText = svgElement('text');
            setAttributes(turretText, {
                transform: 'matrix(1.036 0 0 1.036 69 157)',
                'font-family': 'Roboto',
                'font-size': 6.77,
                'font-weight': 600,
            });
            this.appendLabelTspan(turretText, 'Turret Armor', 0, 0);
            this.appendLabelTspan(turretText, `( ${turret} )`, 0, 8.116);
            labels.appendChild(turretText);
        }
        group.appendChild(labels);
    }

    private appendVerticalArmorLabel(
        parent: SVGElement,
        label: string,
        value: number,
        transform: string,
        valueX: number,
        labelWidth?: number,
    ): void {
        const text = svgElement('text');
        setAttributes(text, {
            transform,
            'font-family': 'Roboto',
            'font-size': 7.74,
            'font-weight': 600,
        });
        const name = this.appendLabelTspan(text, label, 0, 0);
        if (labelWidth !== undefined) {
            name.setAttribute('textLength', formatNumber(labelWidth));
            name.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
        this.appendLabelTspan(text, `( ${value} )`, valueX, 0);
        parent.appendChild(text);
    }

    private appendLabelTspan(
        parent: SVGTextElement,
        value: string,
        x: number,
        y: number,
    ): SVGTSpanElement {
        const tspan = svgElement('tspan');
        setAttributes(tspan, { x, y });
        tspan.textContent = value;
        parent.appendChild(tspan);
        return tspan;
    }

    private armorValueReader(entity: BaseEntity): (...codes: readonly string[]) => number {
        const values = new Map(entity.damageLocations()
            .map(location => [location.sheetCode ?? location.code, location.armor.front] as const));
        return (...codes: readonly string[]): number => {
            for (const code of codes) {
                const value = values.get(code);
                if (value !== undefined) return value;
            }
            return 0;
        };
    }
}
