import type { UnitComponent } from '../../../models/units.model';
import {
    buildComponentMatrixLayout,
    createComponentMatrixAreas,
    hasComponentMatrixLayout,
    normalizeComponentLocation,
    type ComponentBayLocationGroup,
} from './unit-details-component-matrix.util';

function createComponent(id: string, name: string, location: string, overrides: Partial<UnitComponent> = {}): UnitComponent {
    return {
        id,
        n: name,
        l: location,
        q: overrides.q ?? 1,
        p: overrides.p ?? 0,
        t: overrides.t ?? 'C',
        ...overrides,
    };
}

function compareComponentsByName(left: UnitComponent, right: UnitComponent): number {
    return left.n.localeCompare(right.n);
}

describe('unit-details-component-matrix util', () => {
    it('reports supported matrix unit types', () => {
        expect(hasComponentMatrixLayout('Mek')).toBeTrue();
        expect(hasComponentMatrixLayout('Tank')).toBeTrue();
        expect(hasComponentMatrixLayout('VTOL')).toBeTrue();
        expect(hasComponentMatrixLayout('BattleArmor')).toBeFalse();
        expect(hasComponentMatrixLayout(undefined)).toBeFalse();
    });

    it('normalizes component locations for grid area names', () => {
        expect(normalizeComponentLocation('*')).toBe('ALL');
        expect(normalizeComponentLocation(' 1/2 ')).toBe('L12');
        expect(normalizeComponentLocation('LA (rear)')).toBe('LArear');
        expect(normalizeComponentLocation('')).toBe('UNK');
    });

    it('returns empty matrix data for unsupported unit types', () => {
        const layout = buildComponentMatrixLayout('BattleArmor', [], [], compareComponentsByName);

        expect(layout.gridAreas).toBe('');
        expect(layout.matrixAreaCodes).toEqual([]);
        expect(layout.areaNameToCodes.size).toBe(0);
        expect(layout.baysForArea.size).toBe(0);
        expect(layout.compsForArea.size).toBe(0);
    });

    it('builds render areas with sorted components and CASE labels', () => {
        const alphaLaser = createComponent('alpha-laser', 'Alpha Laser', 'CT', { t: 'E' });
        const zetaLauncher = createComponent('zeta-launcher', 'Zeta Launcher', 'CT', { t: 'M' });
        const leftArmActuator = createComponent('left-arm-actuator', 'Left Arm Actuator', 'LA');

        const layout = buildComponentMatrixLayout(
            'Mek',
            [],
            [zetaLauncher, leftArmActuator, alphaLaser],
            compareComponentsByName,
        );
        const areas = createComponentMatrixAreas(layout, new Map([['CT', '[CASE]']]));
        const centerTorsoArea = areas.find(area => area.area === 'CT');

        expect(layout.gridAreas).toBe('"LA . ." ". CT ."');
        expect(layout.matrixAreaCodes).toEqual(['LA', 'CT']);
        expect(centerTorsoArea?.label).toBe('CT');
        expect(centerTorsoArea?.caseLabel).toBe('[CASE]');
        expect(centerTorsoArea?.components.map(component => component.n)).toEqual(['Alpha Laser', 'Zeta Launcher']);
    });

    it('merges duplicate bay entries inside a matrix area', () => {
        const groupedBays: ComponentBayLocationGroup[] = [
            {
                l: 'LA',
                p: 0,
                bays: [createComponent('medium-laser-a', 'Medium Laser', 'LA', { q: 1, t: 'E' })],
            },
            {
                l: 'LA',
                p: 0,
                bays: [
                    createComponent('medium-laser-b', 'Medium Laser', 'LA', { q: 2, t: 'E' }),
                    createComponent('ac-5', 'AC/5', 'LA', { q: 2, t: 'B' }),
                ],
            },
        ];

        const layout = buildComponentMatrixLayout('Mek', groupedBays, [], compareComponentsByName);
        const baySummary = (layout.baysForArea.get('LA') ?? []).map(bay => ({ n: bay.n, q: bay.q }));

        expect(layout.gridAreas).toBe('"LA . ."');
        expect(baySummary).toEqual([
            { n: 'AC/5', q: 2 },
            { n: 'Medium Laser', q: 3 },
        ]);
    });

    it('moves tank body content into an empty borrow-up slot when allowed', () => {
        const frontLeftSide = createComponent('front-left-side', 'Front Left Side Armor', 'FRLS');
        const bodyEquipment = createComponent('body-equipment', 'Body Equipment', 'BD');

        const layout = buildComponentMatrixLayout(
            'Tank',
            [],
            [frontLeftSide, bodyEquipment],
            compareComponentsByName,
        );

        expect(layout.gridAreas).toBe('"FRLS BD ."');
        expect(layout.matrixAreaCodes).toEqual(['FRLS', 'BD']);
    });

    it('expands fallback slots from the area above when the fallback row has other content', () => {
        const centerTorsoEquipment = createComponent('center-torso-equipment', 'Center Torso Equipment', 'CT');
        const rightLegEquipment = createComponent('right-leg-equipment', 'Right Leg Equipment', 'RL');

        const layout = buildComponentMatrixLayout(
            'Mek',
            [],
            [centerTorsoEquipment, rightLegEquipment],
            compareComponentsByName,
        );

        expect(layout.gridAreas).toBe('". CT ." ". CT RL"');
        expect(layout.matrixAreaCodes).toEqual(['CT', 'RL']);
    });

    it('adds normalized extra locations that are not declared by the matrix spec', () => {
        const customEquipment = createComponent('custom-equipment', 'Custom Equipment', '1*bad');

        const layout = buildComponentMatrixLayout('Mek', [], [customEquipment], compareComponentsByName);
        const areas = createComponentMatrixAreas(layout, new Map());

        expect(layout.gridAreas).toBe('"L1bad . ."');
        expect(layout.matrixAreaCodes).toEqual(['L1bad']);
        expect(areas[0].label).toBe('L1bad');
        expect(areas[0].components).toEqual([customEquipment]);
    });
});