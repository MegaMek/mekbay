import { CapitalShipPipRenderer } from './capital-ship-pip-renderer';
import { RecordSheetDamageHighlights } from './record-sheet-damage-highlights';
import { GenericPipRenderer } from './generic-pip-renderer';
import { PipRendererShared } from './pip-renderer.shared';
import { MIN_PIP_SHAPE_SIZE, PipShapeProfileGenerator } from './pip-shape-profile-generator';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

describe('Pip renderers', () => {
    let highlights: RecordSheetDamageHighlights;
    beforeEach(() => { highlights = new RecordSheetDamageHighlights(); });

    afterEach(() => {
        highlights.destroy();
    });

    it('reproduces capital-vessel square armor blocks with layered paths', () => {
        const pips = CapitalShipPipRenderer.createPips(100, 200, 100, 'armor', 'NOS');
        const block = pips?.querySelector<SVGGElement>('.capital-pip-block');

        expect(pips?.querySelectorAll('rect').length).toBe(0);
        expect(pips?.querySelectorAll('.pip').length).toBe(0);
        expect(pips?.querySelectorAll('.capital-pip-block').length).toBe(1);
        expect(block?.querySelectorAll('.capital-pip-state').length).toBe(5);
        expect(block?.querySelectorAll('.capital-pip-interaction').length).toBe(1);
        expect(pips?.dataset['pipCapacity']).toBe('100');
        expect(pips?.dataset['pipLayout']).toBe('capital-grid');
    });

    it('uses the capital-vessel structure block capacity for each track', () => {
        const kf = CapitalShipPipRenderer.createPips(14, 80, 15, 'structure', 'KF');
        const sail = CapitalShipPipRenderer.createPips(5, 80, 5, 'structure', 'SAIL');
        const kfBlock = kf?.querySelector<SVGGElement>('.capital-pip-block');
        const sailBlock = sail?.querySelector<SVGGElement>('.capital-pip-block');

        expect(kfBlock?.dataset['pipBlockCount']).toBe('14');
        expect(sailBlock?.dataset['pipBlockCount']).toBe('5');
    });

    it('reduces six thousand capital points to sixty block targets', () => {
        const pips = CapitalShipPipRenderer.createPips(6_000, 1_000, 500, 'armor', 'NOS');
        const blocks = pips?.querySelectorAll('.capital-pip-block') ?? [];
        const targets = pips?.querySelectorAll('.capital-pip-interaction') ?? [];

        expect(blocks.length).toBe(60);
        expect(targets.length).toBe(60);
        expect(pips?.querySelectorAll('.pip').length).toBe(0);
        expect(pips?.querySelectorAll('rect').length).toBe(0);
        expect(pips?.querySelectorAll('*').length).toBe(600);
    });

    it('keeps block gaps and unused cells outside the capital-grid hit targets', () => {
        const pips = CapitalShipPipRenderer.createPips(101, 200, 100, 'armor', 'NOS')!;
        const targets = [...pips.querySelectorAll<SVGPathElement>('.capital-pip-interaction')];

        expect(targets.length).toBe(2);
        expect(pips.querySelector(':scope > .capital-pip-interaction')).toBeNull();
        expect(targets.every(target => target.parentElement?.classList.contains('capital-pip-block')))
            .toBeTrue();
        expect(targets[1].getAttribute('d')?.match(/Z/gu)?.length).toBe(1);
    });

    it('projects pending and fresh capital-grid damage and repairs into solid paths', () => {
        const pips = CapitalShipPipRenderer.createPips(100, 200, 100, 'armor', 'NOS')!;
        const statePath = (className: string): string =>
            pips.querySelector(`.${className}`)?.getAttribute('d') ?? '';

        CapitalShipPipRenderer.renderDamage(highlights, [pips], 100, 98, 96);
        expect(statePath('capital-pip-state-damaged')).not.toBe('');
        expect(statePath('capital-pip-state-pending-damage')).not.toBe('');
        expect(statePath('capital-pip-state-fresh-damage')).toBe('');

        CapitalShipPipRenderer.renderDamage(highlights, [pips], 100, 98, 94, true);
        expect(statePath('capital-pip-state-pending-damage')).not.toBe('');
        expect(statePath('capital-pip-state-fresh-damage')).not.toBe('');

        CapitalShipPipRenderer.renderDamage(highlights, [pips], 100, 94, 98, true);
        expect(statePath('capital-pip-state-fresh-repair')).not.toBe('');
        expect(statePath('capital-pip-state-pending-repair')).toBe('');

        CapitalShipPipRenderer.renderDamage(highlights, [pips], 100, 94, 98, true);
        expect(statePath('capital-pip-state-fresh-repair')).not.toBe('');
        expect(statePath('capital-pip-state-pending-repair')).toBe('');
        CapitalShipPipRenderer.renderDamage(highlights, [pips], 100, 94, 98, false);
        expect(statePath('capital-pip-state-fresh-repair')).toBe('');
        expect(statePath('capital-pip-state-pending-repair')).not.toBe('');
    });

    it('does not generate shapes below the minimum size', () => {
        const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
        rectangle.setAttribute('width', (MIN_PIP_SHAPE_SIZE / 2).toString());
        rectangle.setAttribute('height', (MIN_PIP_SHAPE_SIZE / 2).toString());

        expect(PipShapeProfileGenerator.createProfile(rectangle)).toBeNull();
    });

    it('prunes expensive generic candidate evaluation for dense layouts', () => {
        const evaluate = spyOn(PipRendererShared, 'getMaximumRadiusForPoints').and.callThrough();
        const pips = GenericPipRenderer.createPips(
            120,
            26.448,
            84.27,
            { inset: 1.8, minPipRadius: 0, pipGap: 0, pipRadius: 100, strokeWidthRatio: 0.2 },
        );

        expect(pips?.querySelectorAll('circle').length).toBe(120);
        expect(evaluate.calls.count()).toBeLessThan(10);
    });
});
