import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { WeaponEquipment } from '../../models/equipment.model';
import type { Unit } from '../../models/units.model';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';
import { ClusterTableDialogComponent, shouldCombineReferenceTables } from './cluster-table-dialog.component';

describe('shouldCombineReferenceTables', () => {
    it('combines only when the complete intrinsic table width fits', () => {
        expect(shouldCombineReferenceTables(800, 800)).toBeTrue();
        expect(shouldCombineReferenceTables(800, 801)).toBeFalse();
        expect(shouldCombineReferenceTables(0, 0)).toBeFalse();
    });
});

describe('ClusterTableDialogComponent', () => {
    const close = jasmine.createSpy('close');

    function createFixture(unit: Unit) {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [ClusterTableDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close } },
                { provide: DIALOG_DATA, useValue: { unit } },
            ],
        });
        const fixture = TestBed.createComponent(ClusterTableDialogComponent);
        fixture.detectChanges();
        return fixture;
    }

    function mekUnit(subtype = 'BattleMek'): Unit {
        return { type: 'Mek', subtype, comp: [] } as unknown as Unit;
    }

    function clusterUnit(): Unit {
        const lrm = new WeaponEquipment({
            id: 'lrm-5',
            name: 'LRM 5',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 5 },
        });
        return {
            type: 'Tank',
            subtype: 'Combat Vehicle',
            comp: [{ id: 'lrm-5', q: 1, n: 'LRM 5', t: 'B', p: 0, l: 'TU', eq: lrm }],
        } as unknown as Unit;
    }

    it('rolls the selected location column from headers and cells', () => {
        const fixture = createFixture(mekUnit());
        const component = fixture.componentInstance;
        const roller = fixture.debugElement.query(node => node.componentInstance instanceof DiceRollerComponent).componentInstance as DiceRollerComponent;
        spyOn(roller, 'roll');

        const leftCells = fixture.nativeElement.querySelectorAll('.hit-location-table tr > :nth-child(2)');
        (leftCells[1] as HTMLTableCellElement).click();
        component.onRollFinished({ results: [1, 1], sum: 2 });

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(component.rolledResult()).toEqual({
            roll: 2,
            value: 'LT(C)',
            column: { table: 'location', column: 'leftSide' },
        });
    });

    it('looks up biped, quad, and tripod location boundaries', () => {
        const cases = [
            { subtype: 'BattleMek', column: 'frontRear' as const, roll: 7, value: 'CT' },
            { subtype: 'QuadMek', column: 'rightSide' as const, roll: 3, value: 'RRL' },
            { subtype: 'TripodMek', column: 'leftSide' as const, roll: 3, value: 'Leg (+1)†' },
            { subtype: 'BattleMek', column: 'rightSide' as const, roll: 12, value: 'HD' },
        ];

        for (const testCase of cases) {
            const fixture = createFixture(mekUnit(testCase.subtype));
            const component = fixture.componentInstance;
            component.rollLocationColumn(testCase.column);
            component.onRollFinished({ results: [], sum: testCase.roll });
            expect(component.rolledResult()?.value).withContext(testCase.subtype).toBe(testCase.value);
            fixture.destroy();
        }
    });

    it('places only the tripod leg note under hit locations', () => {
        const fixture = createFixture(mekUnit('TripodMek'));
        const component = fixture.componentInstance;

        expect(component.hitLocationNotes.map(note => note.id)).toEqual(['tripodLeg']);
        expect(component.clusterNotes.map(note => note.id)).not.toContain('tripodLeg');
        expect(fixture.nativeElement.querySelector('.table-section .note:last-child')?.textContent)
            .toContain('For a tripod');
        expect(fixture.nativeElement.querySelector('.cluster-hit-table')?.parentElement?.parentElement?.textContent ?? '')
            .not.toContain('For a tripod');
    });

    it('does not add a hit-location note for non-tripod units', () => {
        const fixture = createFixture(mekUnit());

        expect(fixture.componentInstance.hitLocationNotes).toEqual([]);
        expect(fixture.nativeElement.querySelectorAll('.table-section .note')).toHaveSize(1);
    });

    it('keeps only a centered dismiss button in the footer', () => {
        const fixture = createFixture(mekUnit());
        const footer = fixture.nativeElement.querySelector('.dialog-buttons') as HTMLElement;

        expect(footer.querySelectorAll('button')).toHaveSize(1);
        expect(footer.textContent?.trim()).toBe('DISMISS');
        expect(footer.querySelector('.notes')).toBeNull();
    });

    it('keeps only column headers in the table keyboard tab order', () => {
        const fixture = createFixture(mekUnit());
        const headerButtons = fixture.nativeElement.querySelectorAll('.hit-location-table thead .table-roll-button');
        const cellButtons = fixture.nativeElement.querySelectorAll('.hit-location-table tbody .table-roll-button');

        expect(headerButtons).toHaveSize(3);
        expect([...headerButtons].every((button: Element) => !button.hasAttribute('tabindex'))).toBeTrue();
        expect([...cellButtons].every((button: Element) => button.getAttribute('tabindex') === '-1')).toBeTrue();
    });

    it('looks up the cluster result in the selected rack-size column', () => {
        const fixture = createFixture(clusterUnit());
        const component = fixture.componentInstance;

        component.rollClusterColumn(5);
        component.onRollFinished({ results: [3, 4], sum: 7 });

        expect(component.rolledResult()).toEqual({
            roll: 7,
            value: '3',
            column: { table: 'cluster', rackSize: 5 },
        });
    });

    it('renders locations before clusters in one table when enough width is available', () => {
        const lrm = new WeaponEquipment({
            id: 'lrm-5',
            name: 'LRM 5',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 5 },
        });
        const fixture = createFixture({
            type: 'Mek',
            subtype: 'BattleMek',
            comp: [{ id: 'lrm-5', q: 1, n: 'LRM 5', t: 'B', p: 0, l: 'RA', eq: lrm }],
        } as unknown as Unit);
        fixture.componentInstance.useCombinedTable.set(true);
        fixture.detectChanges();

        const table = fixture.nativeElement.querySelector('.combined-table') as HTMLTableElement;
        const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent?.trim());
        expect(headers).toEqual(['2d6 roll', 'LS', 'F/R', 'RS', '5']);
        expect(fixture.nativeElement.querySelectorAll('.combined-table')).toHaveSize(1);
        expect(fixture.nativeElement.querySelector('.hit-location-table')).toBeNull();
        expect(fixture.nativeElement.querySelector('.cluster-hit-table')).toBeNull();
        expect(table.querySelectorAll('tbody tr')).toHaveSize(11);
        expect(fixture.nativeElement.querySelector('.physical-location-table')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.combined-table .physical-location-table')).toBeNull();
    });

    it('keeps dialog content hidden until the responsive layout is resolved', () => {
        const fixture = createFixture(clusterUnit());
        const component = fixture.componentInstance;
        component.useCombinedTable.set(true);
        component.layoutResolved.set(false);
        fixture.detectChanges();

        const content = fixture.nativeElement.querySelector('.dialog-content') as HTMLElement;
        expect(content.classList).toContain('layout-pending');
        expect(fixture.nativeElement.querySelectorAll('.combined-table')).toHaveSize(1);

        component.layoutResolved.set(true);
        fixture.detectChanges();

        expect(content.classList).not.toContain('layout-pending');
    });

    it('renders the grouped punch and kick table as a separate section after hit locations', () => {
        const fixture = createFixture(mekUnit());
        const sections = [...fixture.nativeElement.querySelectorAll('.table-section')] as HTMLElement[];
        const physicalSection = sections.at(-1)!;
        const table = physicalSection.querySelector('.physical-location-table') as HTMLTableElement;

        expect(physicalSection.querySelector('h3')?.textContent).toBe('PUNCH & KICK LOCATION TABLE');
        expect([...table.querySelectorAll('thead tr:first-child th')].map(cell => ({
            text: cell.textContent?.replace(/\s+/g, ' ').trim(),
            colspan: cell.getAttribute('colspan'),
        }))).toEqual([
            { text: '1d6 roll', colspan: null },
            { text: 'PUNCH', colspan: '3' },
            { text: 'KICK', colspan: '3' },
        ]);
        expect([...table.querySelectorAll('thead tr:nth-child(2) th')].map(cell => cell.textContent?.trim()))
            .toEqual(['LS', 'F/R', 'RS', 'LS', 'F/R', 'RS']);
        expect(table.querySelectorAll('tbody tr')).toHaveSize(6);
        expect([...table.querySelectorAll('tbody tr:first-child td')].map(cell => cell.textContent?.trim()))
            .toEqual(['1', 'LT', 'LA', 'RT', 'LL', 'RL', 'RL']);
    });

    it('rolls one die and highlights the selected physical location', () => {
        const fixture = createFixture(mekUnit());
        const component = fixture.componentInstance;
        const rollers = fixture.debugElement.queryAll(node => node.componentInstance instanceof DiceRollerComponent);
        const physicalRoller = rollers
            .map(node => node.componentInstance as DiceRollerComponent)
            .find(roller => roller.diceCount() === 1)!;
        spyOn(physicalRoller, 'roll');

        component.rollPhysicalColumn('kickFrontRear');
        component.onRollFinished({ results: [4], sum: 4 });
        fixture.detectChanges();

        expect(physicalRoller.roll).toHaveBeenCalledTimes(1);
        expect(component.rolledResult()).toEqual({
            roll: 4,
            value: 'LL',
            column: { table: 'physical', column: 'kickFrontRear' },
        });
        expect(fixture.nativeElement.querySelectorAll('.physical-location-table tr.rolled-row-highlight')).toHaveSize(1);
        expect(fixture.nativeElement.querySelector('.physical-location-table td.rolled-highlight')?.textContent.trim()).toBe('LL');

        physicalRoller.isRolling.set(false);
        component.rollPhysicalColumn('punchLeftSide');
        component.onRollFinished({ results: [0], sum: 0 });
        expect(component.rolledResult()).toBeNull();
        component.onRollFinished({ results: [7], sum: 7 });
        expect(component.rolledResult()).toBeNull();
    });

    it('omits physical locations for units without a Mek hit-location table', () => {
        const fixture = createFixture(clusterUnit());

        expect(fixture.componentInstance.physicalRows).toEqual([]);
        expect(fixture.nativeElement.querySelector('.physical-location-table')).toBeNull();
    });

    it('highlights only the resolved cell as soon as the roll finishes', () => {
        const fixture = createFixture(mekUnit());
        const component = fixture.componentInstance;

        component.rollLocationColumn('frontRear');
        component.onRollFinished({ results: [3, 4], sum: 7 });
        fixture.detectChanges();

        expect(component.rolledResult()).toEqual({
            roll: 7,
            value: 'CT',
            column: { table: 'location', column: 'frontRear' },
        });
        const highlightedRow = fixture.nativeElement.querySelector('.hit-location-table tr.rolled-row-highlight');
        expect(highlightedRow).not.toBeNull();
        expect(highlightedRow.querySelectorAll('td')).toHaveSize(4);
        expect(highlightedRow.querySelector('td:first-child')?.textContent.trim()).toBe('7');
        const highlightedCells = fixture.nativeElement.querySelectorAll('td.rolled-highlight');
        expect(highlightedCells).toHaveSize(1);
        expect(highlightedCells[0].textContent.trim()).toBe('CT');

        const roller = fixture.debugElement.query(node => node.componentInstance instanceof DiceRollerComponent).componentInstance as DiceRollerComponent;
        roller.isRolling.set(false);
        component.rollLocationColumn('leftSide');
        expect(component.rolledResult()).toBeNull();
    });

    it('highlights a whole column on mouse hover but ignores touch hover', () => {
        const fixture = createFixture(mekUnit());
        const component = fixture.componentInstance;

        component.setHoveredColumn(new PointerEvent('pointerenter', { pointerType: 'touch' }), component.locationColumnKey('leftSide'));
        expect(component.hoveredColumnKey()).toBeNull();

        component.setHoveredColumn(new PointerEvent('pointerenter', { pointerType: 'mouse' }), component.locationColumnKey('leftSide'));
        fixture.detectChanges();
        expect(component.hoveredColumnKey()).toBe('location:leftSide');
        expect(fixture.nativeElement.querySelectorAll('.hit-location-table td.column-hovered')).toHaveSize(11);
        expect(fixture.nativeElement.querySelectorAll('.hit-location-table th.column-hovered')).toHaveSize(0);

        component.clearHoveredColumn(component.locationColumnKey('leftSide'));
        expect(component.hoveredColumnKey()).toBeNull();
    });

    it('ignores invalid roll totals safely', () => {
        const fixture = createFixture(mekUnit());
        const component = fixture.componentInstance;
        component.rollLocationColumn('leftSide');

        component.onRollFinished({ results: [], sum: 1 });
        expect(component.rolledResult()).toBeNull();
        component.onRollFinished({ results: [], sum: 13 });
        expect(component.rolledResult()).toBeNull();
    });
});
