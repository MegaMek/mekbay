// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { WeaponEquipment } from '../../models/equipment.model';
import type { Unit } from '../../models/units.model';
import { CBTGameRules, CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../models/rules/game-rules';
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

    function createFixture(unit: Unit, gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [ClusterTableDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close } },
                { provide: DIALOG_DATA, useValue: { unit, gameRules } },
            ],
        });
        const fixture = TestBed.createComponent(ClusterTableDialogComponent);
        fixture.detectChanges();
        return fixture;
    }

    function unit(overrides: Partial<Unit>): Unit {
        return {
            type: 'Mek',
            subtype: 'BattleMek',
            weightClass: 'Medium',
            tons: 50,
            comp: [],
            ...overrides,
        } as unknown as Unit;
    }

    function clusterWeaponUnit(overrides: Partial<Unit> = {}): Unit {
        const lrm = new WeaponEquipment({
            id: 'lrm-5',
            name: 'LRM 5',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 5 },
        });
        return unit({
            comp: [{ id: 'lrm-5', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'RA', eq: lrm }],
            ...overrides,
        });
    }

    function selectTable(fixture: ReturnType<typeof createFixture>, groupId: string, optionId: string): void {
        (fixture.nativeElement.querySelector(`[data-table-group="${groupId}"]`) as HTMLButtonElement).click();
        fixture.detectChanges();
        const option = fixture.nativeElement.querySelector(`[data-table-option="${optionId}"]`) as HTMLButtonElement | null;
        option?.click();
        fixture.detectChanges();
    }

    it('starts on the current unit table and renders one flat control per group', () => {
        const fixture = createFixture(unit({ subtype: 'Tripod BattleMek' }));

        expect(fixture.componentInstance.selectedOptionId()).toBe('mek-tripod');
        expect(fixture.nativeElement.querySelectorAll('.table-group-button')).toHaveSize(4);
        expect(fixture.nativeElement.querySelectorAll('.table-selector select')).toHaveSize(0);
        expect(fixture.nativeElement.querySelector('[data-table-group="mek"]')?.textContent).toContain('Mek · Tripod');
        expect(fixture.nativeElement.querySelector('[data-table-key="mek-tripod-locations"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="mek-physical-locations"]')).not.toBeNull();
    });

    it('expands a multi-option group and selects its subtype', () => {
        const fixture = createFixture(unit({}));

        const vehicleButton = fixture.nativeElement.querySelector('[data-table-group="vehicle"]') as HTMLButtonElement;
        expect(vehicleButton.textContent).toContain('Vehicle');
        expect(vehicleButton.textContent).not.toContain('VTOL');

        vehicleButton.click();
        fixture.detectChanges();
        const menu = fixture.nativeElement.querySelector('.table-subtype-menu') as HTMLElement;
        expect(menu.querySelectorAll('.table-subtype-button')).toHaveSize(3);
        expect(getComputedStyle(menu).position).toBe('absolute');
        expect(getComputedStyle(menu).flexDirection).toBe('column');

        (fixture.nativeElement.querySelector('[data-table-option="vehicle-vtol"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(fixture.componentInstance.selectedOptionId()).toBe('vehicle-vtol');
        expect(fixture.componentInstance.selectedGroupId()).toBe('vehicle');
        expect(vehicleButton.textContent).toContain('Vehicle · VTOL');
        expect(fixture.nativeElement.querySelector('.table-subtype-menu')).toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="vehicle-vtol-locations"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="vehicle-vtol-critical"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="vehicle-motive-damage"]')).toBeNull();
    });

    it('selects a single-option group with one click', () => {
        const fixture = createFixture(unit({}));

        (fixture.nativeElement.querySelector('[data-table-group="cluster"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(fixture.componentInstance.selectedOptionId()).toBe('cluster-full');
        expect(fixture.nativeElement.querySelector('.table-subtype-menu')).toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="cluster-full"]')).not.toBeNull();
    });

    it('defaults vehicles and infantry to their own reference tables', () => {
        const ground = createFixture(unit({ type: 'Tank', subtype: 'Combat Vehicle' }));
        expect(ground.componentInstance.selectedOptionId()).toBe('vehicle-ground');
        ground.destroy();

        const superheavy = createFixture(unit({
            type: 'Tank',
            subtype: 'Support Vehicle',
            weightClass: 'Large Support Vehicle',
            tons: 180,
        }));
        expect(superheavy.componentInstance.selectedOptionId()).toBe('vehicle-ground-superheavy');
        superheavy.destroy();

        const infantry = createFixture(unit({ type: 'Infantry', subtype: 'Conventional Infantry' }));
        expect(infantry.componentInstance.selectedOptionId()).toBe('infantry-conventional');
        infantry.destroy();
    });

    it('rolls a generic table column and records its result', () => {
        const fixture = createFixture(unit({}));
        const component = fixture.componentInstance;
        const roller = fixture.debugElement
            .queryAll(node => node.componentInstance instanceof DiceRollerComponent)
            .map(node => node.componentInstance as DiceRollerComponent)
            .find(candidate => candidate.diceCount() === 2)!;
        spyOn(roller, 'roll');

        const leftHeader = fixture.nativeElement
            .querySelector('[data-table-key="mek-biped-locations"] thead th:nth-child(2)') as HTMLTableCellElement;
        leftHeader.click();
        component.onRollFinished({ results: [1, 1], sum: 2 }, 2);
        fixture.detectChanges();

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(component.rolledResult()).toEqual({
            tableKey: 'mek-biped-locations',
            columnKey: 'leftSide',
            rowKey: 'roll-2',
            roll: 2,
            value: 'LT(C)',
        });
        expect(component.rollCount()).toBe(1);
        expect(component.rollHistory()[0]).toEqual(jasmine.objectContaining({
            dice: '2d6',
            faces: [1, 1],
            table: 'Biped',
            result: 'LT(C)',
        }));
        expect(fixture.nativeElement.querySelector('td.rolled-highlight')?.textContent.trim()).toBe('LT(C)');
    });

    it('rolls the configured one-die physical table and preserves grouped kick cells', () => {
        const fixture = createFixture(unit({}), TW_GAME_RULES);
        const component = fixture.componentInstance;
        const table = component.displayedTables().find(candidate => candidate.key === 'mek-physical-locations')!;
        const column = table.columns.find(candidate => candidate.key === 'kickFrontRear')!;
        const roller = fixture.debugElement
            .queryAll(node => node.componentInstance instanceof DiceRollerComponent)
            .map(node => node.componentInstance as DiceRollerComponent)
            .find(candidate => candidate.diceCount() === 1)!;
        spyOn(roller, 'roll');

        component.rollTableColumn(table, column);
        component.onRollFinished({ results: [4], sum: 4 }, 1);
        fixture.detectChanges();

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(component.rolledResult()?.value).toBe('LL');
        expect(fixture.nativeElement.querySelectorAll('[data-table-key="mek-physical-locations"] td[rowspan="3"]')).toHaveSize(6);
        expect(fixture.nativeElement.querySelector('[data-table-key="mek-physical-locations"] td.rolled-highlight')?.textContent.trim()).toBe('LL');
    });

    it('keeps only rollable column headers in the keyboard tab order', () => {
        const fixture = createFixture(unit({}));
        const table = fixture.nativeElement.querySelector('[data-table-key="mek-biped-locations"]') as HTMLTableElement;
        const headerButtons = table.querySelectorAll('thead .table-roll-button');
        const cellButtons = table.querySelectorAll('tbody .table-roll-button');

        expect(headerButtons).toHaveSize(3);
        expect([...headerButtons].every(button => !button.hasAttribute('tabindex'))).toBeTrue();
        expect([...headerButtons].every(button => button.classList.contains('bt-button'))).toBeTrue();
        expect([...cellButtons].every(button => button.getAttribute('tabindex') === '-1')).toBeTrue();
        expect([...cellButtons].every(button => !button.classList.contains('bt-button'))).toBeTrue();
    });

    it('stretches roll buttons to the full height of a wrapped header row', () => {
        const fixture = createFixture(unit({}));
        const rollLabel = fixture.nativeElement.querySelector(
            '[data-table-key="mek-biped-locations"] th.roll-column',
        ) as HTMLTableCellElement;
        rollLabel.innerHTML = '2d6<br>roll';

        const button = fixture.nativeElement.querySelector(
            '[data-table-key="mek-biped-locations"] .roll-header-button',
        ) as HTMLButtonElement;
        const header = button.closest('th')!;

        expect(rollLabel.getBoundingClientRect().height).toBeGreaterThan(32);
        expect(Math.abs(button.getBoundingClientRect().height - header.getBoundingClientRect().height)).toBeLessThan(1);
    });

    it('centers constrained roll results inside wide table cells', () => {
        const fixture = createFixture(unit({ type: 'Tank', subtype: 'Combat Vehicle' }));
        const button = fixture.nativeElement.querySelector(
            '[data-table-key="vehicle-motive-damage"] tbody .table-roll-button',
        ) as HTMLButtonElement;
        const buttonBounds = button.getBoundingClientRect();
        const cellBounds = button.closest('td')!.getBoundingClientRect();

        expect(Math.abs(
            buttonBounds.left + buttonBounds.width / 2 - (cellBounds.left + cellBounds.width / 2),
        )).toBeLessThan(1);
    });

    it('does not make informational tables rollable', () => {
        const fixture = createFixture(unit({ type: 'Infantry', subtype: 'Conventional Infantry' }));

        expect(fixture.nativeElement.querySelectorAll('.reference-table .table-roll-button')).toHaveSize(0);
        expect(fixture.componentInstance.hasRollableTable()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.roll-instructions')).toBeNull();

        const label = fixture.nativeElement.querySelector('.table-header-label') as HTMLElement;
        const header = label.closest('th')!;
        expect(getComputedStyle(label).display).toBe('block');
        expect(Math.abs(label.getBoundingClientRect().width - header.clientWidth)).toBeLessThan(1);
    });

    it('renders swarm modifiers with grouped attacking and friendly headers', () => {
        const fixture = createFixture(unit({ type: 'Infantry', subtype: 'Battle Armor' }));
        const table = fixture.nativeElement.querySelector(
            '[data-table-key="battle-armor-swarm-modifiers"]',
        ) as HTMLTableElement;
        const headerRows = table.querySelectorAll('thead tr');

        expect([...headerRows[0].querySelectorAll('th')].map(header => header.textContent?.trim()))
            .toEqual(['ATTACKING BA', 'FRIENDLY']);
        expect(headerRows[0].querySelectorAll('th')[1].getAttribute('colspan')).toBe('6');
        expect([...headerRows[1].querySelectorAll('th')].map(header => header.textContent?.trim()))
            .toEqual(['ACTIVE', '1', '2', '3', '4', '5', '6']);
    });

    it('lets compact reference tables share rows while wide tables span the grid', () => {
        const fixture = createFixture(unit({ type: 'Infantry', subtype: 'Battle Armor' }));
        const content = fixture.nativeElement.querySelector('.dialog-content') as HTMLElement;
        const legAttacks = fixture.nativeElement.querySelector(
            '[data-table-section="battle-armor-leg-attacks"]',
        ) as HTMLElement;
        const swarmAttacks = fixture.nativeElement.querySelector(
            '[data-table-section="battle-armor-swarm-attacks"]',
        ) as HTMLElement;
        const swarmModifiers = fixture.nativeElement.querySelector(
            '[data-table-section="battle-armor-swarm-modifiers"]',
        ) as HTMLElement;

        expect(getComputedStyle(content).display).toBe('grid');
        expect(legAttacks.classList).toContain('compact-table-section');
        expect(swarmAttacks.classList).toContain('compact-table-section');
        expect(swarmModifiers.classList).not.toContain('compact-table-section');
        expect(getComputedStyle(legAttacks).gridColumnEnd).toBe('auto');
        expect(getComputedStyle(swarmModifiers).gridColumnStart).toBe('1');
        expect(getComputedStyle(swarmModifiers).gridColumnEnd).toBe('-1');

        content.style.flex = 'none';
        content.style.width = '860px';
        const legBounds = legAttacks.getBoundingClientRect();
        const swarmBounds = swarmAttacks.getBoundingClientRect();
        const modifierBounds = swarmModifiers.getBoundingClientRect();

        expect(Math.abs(legBounds.top - swarmBounds.top)).toBeLessThan(1);
        expect(modifierBounds.width).toBeGreaterThan(legBounds.width * 1.9);
    });

    it('renders both burst-fire titles as two deliberate lines', () => {
        const fixture = createFixture(unit({ type: 'Infantry', subtype: 'Conventional Infantry' }));
        const expectedTitles = new Map([
            ['conventional-burst-fire-vehicles', "BURST-FIRE DAMAGE\n'MECHS, PROTOMECHS & VEHICLES"],
            ['conventional-burst-fire-ba', 'BURST-FIRE DAMAGE\nBATTLE ARMOR'],
        ]);

        for (const [key, title] of expectedTitles) {
            const heading = fixture.nativeElement.querySelector(
                `[data-table-section="${key}"] > h3`,
            ) as HTMLHeadingElement;
            expect(heading.textContent).toBe(title);
            expect(getComputedStyle(heading).whiteSpace).toBe('pre-line');
        }
    });

    it('merges unit cluster columns with a selected hit-location table when they fit', () => {
        const fixture = createFixture(clusterWeaponUnit());
        fixture.componentInstance.useCombinedTable.set(true);
        fixture.detectChanges();

        const table = fixture.nativeElement.querySelector('.combined-table') as HTMLTableElement;
        const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent?.trim());
        expect(headers).toEqual(['2d6 roll', 'LS', 'F/R', 'RS', '5']);
        expect(fixture.nativeElement.querySelector('[data-table-key="cluster-unit"]')).toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="mek-physical-locations"]')).not.toBeNull();
    });

    it('attributes rolls from a merged table to their source table', () => {
        const fixture = createFixture(clusterWeaponUnit());
        const component = fixture.componentInstance;
        const table = component.displayedTables().find(candidate => candidate.key.includes('+'))!;
        const roller = fixture.debugElement
            .queryAll(node => node.componentInstance instanceof DiceRollerComponent)
            .map(node => node.componentInstance as DiceRollerComponent)
            .find(candidate => candidate.diceCount() === 2)!;
        spyOn(roller, 'roll');

        component.rollTableColumn(table, table.columns.find(column => column.key === 'frontRear')!);
        component.onRollFinished({ results: [3, 4], sum: 7 }, 2);
        component.rollTableColumn(table, table.columns.find(column => column.key === 'rack-5')!);
        component.onRollFinished({ results: [3, 4], sum: 7 }, 2);
        fixture.detectChanges();

        expect(component.rollHistory().map(entry => entry.table)).toEqual(['Biped', 'Cluster']);
        const headerLabels = [...fixture.nativeElement.querySelectorAll('.combined-table .roll-header-button')]
            .map(button => button.getAttribute('aria-label'));
        expect(headerLabels).toContain('Roll F/R on Biped');
        expect(headerLabels).toContain('Roll 5 on Cluster');
    });

    it('shows separate hit-location and unit cluster tables when merging is disabled', () => {
        const fixture = createFixture(clusterWeaponUnit());
        fixture.componentInstance.useCombinedTable.set(false);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[data-table-key="mek-biped-locations"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-table-key="cluster-unit"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.combined-table')).toBeNull();
    });

    it('renders the full cluster table from the Cluster family', () => {
        const fixture = createFixture(unit({}));
        selectTable(fixture, 'cluster', 'cluster-full');

        const table = fixture.nativeElement.querySelector('[data-table-key="cluster-full"]') as HTMLTableElement;
        expect(table.querySelectorAll('thead th')).toHaveSize(22);
        expect(table.querySelectorAll('tbody tr')).toHaveSize(11);
        expect([...table.querySelectorAll('thead th')].at(-1)?.textContent?.trim()).toBe('40');
    });

    it('opens, displays, and resets roll history from the footer counter', () => {
        const fixture = createFixture(unit({}));
        const component = fixture.componentInstance;
        const table = component.displayedTables().find(candidate => candidate.key === 'mek-biped-locations')!;
        component.rollTableColumn(table, table.columns[1]);
        component.onRollFinished({ results: [3, 4], sum: 7 }, 2);
        fixture.detectChanges();

        const footer = fixture.nativeElement.querySelector('.dialog-buttons') as HTMLElement;
        expect(footer.querySelectorAll('button')).toHaveSize(2);
        expect(footer.querySelector('.history-button')?.textContent.trim()).toBe('#1');

        (footer.querySelector('.history-button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.history-entry strong')?.textContent).toContain('CT');

        (fixture.nativeElement.querySelector('.reset-history-button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(component.rollCount()).toBe(0);
        expect(fixture.nativeElement.querySelector('.empty-history')?.textContent).toContain('No rolls');
    });

    it('keeps roll history when the dialog is closed and reopened', () => {
        const firstFixture = createFixture(unit({}));
        const firstComponent = firstFixture.componentInstance;
        firstComponent.resetHistory();
        const table = firstComponent.displayedTables().find(candidate => candidate.key === 'mek-biped-locations')!;
        const roller = firstFixture.debugElement
            .queryAll(node => node.componentInstance instanceof DiceRollerComponent)
            .map(node => node.componentInstance as DiceRollerComponent)
            .find(candidate => candidate.diceCount() === 2)!;
        spyOn(roller, 'roll');

        firstComponent.rollTableColumn(table, table.columns[1]);
        firstComponent.onRollFinished({ results: [3, 4], sum: 7 }, 2);
        firstComponent.close();
        firstFixture.destroy();

        const reopenedFixture = TestBed.createComponent(ClusterTableDialogComponent);
        reopenedFixture.detectChanges();

        expect(reopenedFixture.componentInstance.rollCount()).toBe(1);
        expect(reopenedFixture.componentInstance.rollHistory()[0].result).toBe('CT');
        reopenedFixture.componentInstance.resetHistory();
    });

    it('scrolls open history to the bottom when a new roll arrives', () => {
        const fixture = createFixture(unit({}));
        const component = fixture.componentInstance;
        component.resetHistory();
        component.historyOpen.set(true);
        fixture.detectChanges();

        const historyList = fixture.nativeElement.querySelector('.roll-history-list') as HTMLElement;
        let scrollTop = 0;
        Object.defineProperties(historyList, {
            scrollHeight: { configurable: true, get: () => 720 },
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => scrollTop = value,
            },
        });
        const table = component.displayedTables().find(candidate => candidate.key === 'mek-biped-locations')!;
        const roller = fixture.debugElement
            .queryAll(node => node.componentInstance instanceof DiceRollerComponent)
            .map(node => node.componentInstance as DiceRollerComponent)
            .find(candidate => candidate.diceCount() === 2)!;
        spyOn(roller, 'roll');

        component.rollTableColumn(table, table.columns[1]);
        component.onRollFinished({ results: [3, 4], sum: 7 }, 2);
        fixture.detectChanges();

        expect(scrollTop).toBe(720);
        component.resetHistory();
    });

    it('ignores invalid totals without adding a history entry', () => {
        const fixture = createFixture(unit({}));
        const component = fixture.componentInstance;
        const table = component.displayedTables().find(candidate => candidate.key === 'mek-biped-locations')!;
        component.rollTableColumn(table, table.columns[0]);

        component.onRollFinished({ results: [], sum: 1 }, 2);
        component.onRollFinished({ results: [], sum: 13 }, 2);

        expect(component.rolledResult()).toBeNull();
        expect(component.rollCount()).toBe(0);
    });

    it('highlights a rollable column for mouse hover but ignores touch hover', () => {
        const fixture = createFixture(unit({}));
        const component = fixture.componentInstance;
        const table = component.displayedTables().find(candidate => candidate.key === 'mek-biped-locations')!;
        const column = table.columns[0];

        component.setHoveredColumn(new PointerEvent('pointerenter', { pointerType: 'touch' }), table, column);
        expect(component.hoveredColumnKey()).toBeNull();

        component.setHoveredColumn(new PointerEvent('pointerenter', { pointerType: 'mouse' }), table, column);
        fixture.detectChanges();
        expect(component.hoveredColumnKey()).toBe('mek-biped-locations:leftSide');
        expect(fixture.nativeElement.querySelectorAll('[data-table-key="mek-biped-locations"] td.column-hovered')).toHaveSize(11);
    });
});
