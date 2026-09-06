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
import { CompactRecordSheetLayout, type RecordSheetLayoutRequest } from './record-sheet-layout';
import {
    compactVehicleSheetTitle,
    drawCompactVehicleChrome,
    drawCompactVehicleCrewPanel,
    drawCompactVehicleCriticalPanel,
    drawCompactVehicleDataPanel,
    drawCompactVehicleDiagram,
    usesSixSideVehicleHull,
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

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<void> {
        if (!this.matches(entity)) throw new Error('Combat-vehicle layout received an unsupported entity');
        const at = (box: Box): Box => scaleCompactBox(svg, box, 375);
        const family = this.paperdollFamily(entity);
        const airborne = family === 'vtol';
        svg.setAttribute('data-mekbay-vehicle-family', family);
        drawCompactVehicleChrome(svg, compactVehicleSheetTitle(entity));
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
                pipLayout: request.pipLayout,
                assetUrl: this.paperdollAsset(entity, family),
                motiveArtId: this.motiveArtId(entity, family),
            },
        );
        this.drawDiagramLabels(diagram, entity, diagramBox, family);
    }

    private paperdollFamily(entity: BaseEntity): CombatVehiclePaperdollFamily {
        const motive = `${entity.entityType} ${entity.getMotiveTypeAsString() ?? ''}`.toLowerCase();
        if (motive.includes('vtol')) return 'vtol';
        if (motive.includes('wige') && !usesSixSideVehicleHull(entity)) return 'wige';
        return 'vehicle';
    }

    private paperdollAsset(entity: BaseEntity, family: CombatVehiclePaperdollFamily): string {
        const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
        const turret = dualTurret || isVehicleEntity(entity) && entity.hasTurret();
        const turretKind = dualTurret && family !== 'vtol' ? 'dualturret' : turret ? 'turret' : 'noturret';
        const superheavy = usesSixSideVehicleHull(entity)
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
        const superheavy = usesSixSideVehicleHull(entity);
        const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
        const hasTurret = isVehicleEntity(entity) && entity.hasTurret();
        const turret = armor('TU', 'T1', 'T');
        const noTurret = !hasTurret && !dualTurret;

        const frontRear = svgElement('text');
        setAttributes(frontRear, {
            transform: superheavy
                ? 'matrix(1.038 0 0 1.038 4.955 11.25) translate(-400.802 -35.489748) translate(485.9 61)'
                : dualTurret
                    ? 'matrix(.96 0 0 .96 14.791 32.25) matrix(1 0 0 -1 -406.254 751.728) matrix(.998 0 0 -1 489.135 744.945)'
                    : `matrix(1.126742 0 0 1.129 90.697086 ${noTurret ? 24.010548 : 25.067548})`,
            'font-family': 'Roboto',
            'font-size': superheavy || dualTurret ? 8.0431 : 7.74,
            'font-weight': superheavy || dualTurret ? 700 : 600,
            'text-anchor': 'middle',
        });
        const frontY = superheavy || dualTurret ? 0 : noTurret ? 13 : 12;
        const rearY = superheavy ? dualTurret ? 280.91 : 282.91 : dualTurret ? 301.512 : noTurret ? 273.91 : 269.91;
        const valueGap = superheavy || dualTurret ? 9.636 : 9.275;
        this.appendLabelTspan(frontRear, 'Front Armor', 0, frontY);
        this.appendLabelTspan(frontRear, `( ${armor('FR', 'F')} )`, 0, frontY + valueGap).id = 'textArmor_FR';
        this.appendLabelTspan(frontRear, 'Rear Armor', 0, rearY);
        this.appendLabelTspan(frontRear, `( ${armor('RR', 'R')} )`, 0, rearY + valueGap).id = 'textArmor_RR';
        labels.appendChild(frontRear);

        if (superheavy) {
            this.appendSuperheavySideArmorLabels(labels, armor);
        } else {
            this.appendVerticalArmorLabel(
                labels,
                'Left Side Armor',
                armor('LS', 'L'),
                dualTurret
                    ? 'matrix(.96 0 0 .96 14.791 32.25) matrix(1 0 0 -1 -406.254 751.728) matrix(0 .998 1 0 412.894 529.791)'
                    : `matrix(0 -1.126742 1.129 0 6.926415 ${noTurret ? 234.648078 : 235.705078})`,
                dualTurret ? 65.6 : 63.083,
                dualTurret ? 62.801 : 60.388,
                dualTurret ? 8.0431 : 7.74,
            );
            this.appendVerticalArmorLabel(
                labels,
                'Right Side Armor',
                armor('RS', 'R'),
                dualTurret
                    ? 'matrix(.96 0 0 .96 14.791 32.25) matrix(1 0 0 -1 -406.254 751.728) matrix(0 -.998 -1 0 575.029 619.724)'
                    : `matrix(0 1.126742 -1.129 0 183.127187 ${noTurret ? 136.911677 : 137.968677})`,
                dualTurret ? 68.214 : 68.285,
                dualTurret ? 68.214 : 65.591,
                dualTurret ? 8.0431 : 7.74,
            );
        }

        if (!dualTurret && hasTurret) {
            const turretText = svgElement('text');
            setAttributes(turretText, {
                transform: superheavy
                    ? 'matrix(1.038 0 0 1.038 4.955 11.25) translate(-400.802 -35.489748) translate(404.3 351.437)'
                    : 'matrix(1.126742 0 0 1.129 68.751584 158.858564)',
                'font-family': 'Roboto',
                'font-size': superheavy ? 8.0431 : 6.77,
                'font-weight': superheavy ? 700 : 600,
            });
            this.appendLabelTspan(turretText, 'Turret Armor', 0, superheavy ? 8.431 : 0);
            this.appendLabelTspan(turretText, `( ${turret} )`, superheavy ? 50.58 : 0,
                superheavy ? 8.431 : 8.116).id = 'textArmor_TU';
            labels.appendChild(turretText);
        }
        if (dualTurret) this.appendDualTurretArmorLabels(labels, armor('FT'), armor('RT'), superheavy);
        group.appendChild(labels);
    }

    /** The six-location hull has separate fore and aft side counters. */
    private appendSuperheavySideArmorLabels(
        parent: SVGElement,
        armor: (...codes: readonly string[]) => number,
    ): void {
        const sides = [
            { transform: 'rotate(-90 353.48801 -52.72973)', parts: [
                ['Rear Left Side Armor', 'RRLS', 0, 77.2],
                ['Front Left Side Armor', 'FRLS', 116.3, 194.8],
            ] },
            { transform: 'rotate(90 237.58794 330.37009)', parts: [
                ['Front Right Side Armor', 'FRRS', 0, 84.152],
                ['Rear Right Side Armor', 'RRRS', 121.6, 203.5],
            ] },
        ] as const;
        for (const side of sides) {
            const text = svgElement('text');
            setAttributes(text, {
                transform: `matrix(1.038 0 0 1.038 4.955 11.25) translate(-400.802 -35.489748) ${side.transform}`,
                'font-family': 'Roboto', 'font-size': 8.0431, 'font-weight': 700,
            });
            for (const [label, location, labelX, valueX] of side.parts) {
                this.appendLabelTspan(text, label, labelX, 0);
                this.appendLabelTspan(text, `( ${armor(location)} )`, valueX, 0).id = `textArmor_${location}`;
            }
            parent.appendChild(text);
        }
    }

    /** Standard turrets carry labels inside the hull; superheavy labels sit outside it. */
    private appendDualTurretArmorLabels(
        parent: SVGElement,
        frontArmor: number,
        rearArmor: number,
        superheavy: boolean,
    ): void {
        const rear = svgElement('text');
        setAttributes(rear, {
            transform: superheavy
                ? 'matrix(1.038 0 0 1.038 4.955 11.25) translate(-400.802 -35.489748) translate(404.3 351.437)'
                : 'matrix(.96 0 0 .96 14.791 32.25) matrix(1 0 0 -1 -406.254 751.728) matrix(.998 0 0 -1 469.784 599.879)',
            'font-family': 'Roboto',
            'font-size': superheavy ? 8.0431 : 7.0377,
            'font-weight': 700,
        });
        this.appendLabelTspan(rear, superheavy ? 'Rear' : 'Rear Turret', 0, 0);
        if (superheavy) this.appendLabelTspan(rear, 'Turret Armor', 0, 8.431);
        this.appendLabelTspan(rear, `( ${rearArmor} )`, superheavy ? 50.58 : 0, 8.431).id = 'textArmor_RT';
        parent.appendChild(rear);

        const front = svgElement('text');
        setAttributes(front, {
            transform: superheavy
                ? 'matrix(1.038 0 0 1.038 4.955 11.25) translate(-400.802 -35.489748) translate(570.964 51.3)'
                : 'matrix(.96 0 0 .96 14.791 32.25) matrix(1 0 0 -1 -406.254 751.728) matrix(.998 0 0 -1 454.732 695.167)',
            'font-family': 'Roboto',
            'font-size': superheavy ? 8.0431 : 7.0377,
            'font-weight': 700,
            'text-anchor': superheavy ? 'end' : 'start',
        });
        this.appendLabelTspan(front, 'Front', 0, superheavy ? 2 : 0);
        this.appendLabelTspan(front, superheavy ? 'Turret Armor' : 'Turret', superheavy ? 0 : -1.422,
            superheavy ? 10.431 : 8.431);
        this.appendLabelTspan(front, `( ${frontArmor} )`, superheavy ? 0 : -1.738,
            superheavy ? 18.862 : 16.862).id = 'textArmor_FT';
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
        if (isVehicleEntity(entity) && entity.hasTurret()) {
            const authored = svgElement('g');
            authored.setAttribute('transform', 'matrix(1.006 0 0 1.006 3.363 11.25) translate(-398.478 -13.05)');
            setAttributes(authored, { 'font-family': 'Roboto', 'font-size': 7.74, 'font-weight': 700 });
            for (const [name, code, transform, counterX] of [
                ['Left Side Armor', 'LS', 'rotate(-90 353.25 -71.55)', 57.383],
                ['Right Side Armor', 'RS', 'rotate(90 166.494 380.753)', 62.585],
            ] as const) {
                const text = svgElement('text');
                text.setAttribute('transform', transform);
                this.appendLabelTspan(text, name, 0, 0);
                this.appendLabelTspan(text, `( ${armor(code)} )`, counterX, 0).id = `textArmor_${code}`;
                authored.appendChild(text);
            }
            for (const [names, code, x, y, gap] of [
                [['Front Armor'], 'FR', 551.878, 94.209, 9.275],
                [['Rear Armor'], 'RR', 448.778, 341.214, 9.275],
                [['Rotor', 'Armor'], 'RO', 559.589, 155.86, 8.116],
                [['Turret', 'Armor'], 'TU', 440.689, 60.26, 8.116],
            ] as const) {
                const text = svgElement('text');
                setAttributes(text, { transform: `translate(${x} ${y})`, 'text-anchor': 'middle' });
                names.forEach((name, index) => this.appendLabelTspan(text, name, 0, index * gap));
                this.appendLabelTspan(text, `( ${armor(code)} )`, 0, names.length * gap).id = `textArmor_${code}`;
                authored.appendChild(text);
            }
            labels.appendChild(authored);
            group.appendChild(labels);
            return;
        }
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
        fontSize = 7.74,
    ): void {
        const text = svgElement('text');
        setAttributes(text, {
            transform,
            'font-family': 'Roboto',
            'font-size': fontSize,
            'font-weight': fontSize === 7.74 ? 600 : 700,
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
