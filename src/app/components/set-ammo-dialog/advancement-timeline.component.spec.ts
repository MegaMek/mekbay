import { TestBed } from '@angular/core/testing';
import { Equipment } from '../../models/equipment.model';
import { AdvancementTimelineComponent, getEquipmentAdvancementTimeline } from './advancement-timeline.component';

describe('AdvancementTimelineComponent', () => {
    function createEquipment(id: string, tech: Partial<Equipment['tech']>): Equipment {
        return new Equipment({
            id,
            name: id,
            type: 'misc',
            rulesRefs: 'Test Rules',
            tech,
        });
    }

    function configureTimeline(equipment: Equipment) {
        TestBed.configureTestingModule({
            imports: [AdvancementTimelineComponent],
        });

        const timeline = getEquipmentAdvancementTimeline(equipment);
        const fixture = TestBed.createComponent(AdvancementTimelineComponent);
        fixture.componentRef.setInput('slots', timeline.slots);
        fixture.componentRef.setInput('timelines', timeline.timelines);
        fixture.detectChanges();
        return fixture;
    }

    it('renders Inner Sphere and Clan advancement as separate timeline rows', () => {
        const mixedEquipment = createEquipment('Universal Test Equipment', {
            base: 'All',
            rating: 'D',
            availability: { sl: 'D', sw: 'D', clan: 'C', da: 'C' },
            advancement: {
                is: { prototype: '2500', production: '2510' },
                clan: { prototype: '2800', production: '2810' },
            },
        });
        const fixture = configureTimeline(mixedEquipment);

        const timelineRows = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-row:not(.header)')) as HTMLElement[];
        const rowLabels = timelineRows.map(row => row.querySelector('.advancement-timeline-row-label')?.textContent?.trim());
        const rowTexts = timelineRows.map(row => row.textContent ?? '');
        const rowTracks = timelineRows.map(row => row.querySelector('.advancement-timeline-track') as HTMLElement);
        const rowCells = rowTracks.map(track => track.querySelectorAll('.advancement-timeline-cell').length);

        expect(rowLabels).toEqual(['IS', 'Clan']);
        expect(rowTexts[0]).toContain('2500');
        expect(rowTexts[0]).toContain('2510');
        expect(rowTexts[1]).toContain('2800');
        expect(rowTexts[1]).toContain('2810');
        expect(rowCells).toEqual([4, 4]);
        expect(rowTracks[0].style.gridTemplateColumns).toBe(rowTracks[1].style.gridTemplateColumns);
        expect(getComputedStyle(fixture.nativeElement.querySelector('.advancement-timeline-header-cell') as HTMLElement).whiteSpace).toBe('nowrap');
    });

    it('orders advancement timeline events by year instead of fixed event type order', () => {
        const unstableEquipment = createEquipment('Unstable Test Equipment', {
            base: 'IS',
            rating: 'E',
            availability: { sl: 'E', sw: 'E', clan: 'E', da: 'E' },
            advancement: {
                is: { prototype: '2500', common: '2900', extinct: '2600', reintroduced: '2800' },
            },
        });
        const fixture = configureTimeline(unstableEquipment);

        const longLabels = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-header-cell .label-long') as NodeListOf<HTMLElement>)
            .map(element => element.textContent?.trim());
        const shortLabels = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-header-cell .label-short') as NodeListOf<HTMLElement>)
            .map(element => element.textContent?.trim());
        const values = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-value') as NodeListOf<HTMLElement>)
            .map(element => element.textContent?.trim());

        expect(longLabels).toEqual(['Prototype', 'Extinction', 'Reintroduction', 'Common']);
        expect(shortLabels).toEqual(['Proto', 'Extinct', 'Reintro', 'Common']);
        expect(values).toEqual(['2500', '2600', '2800', '2900']);

        const eventCells = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-cell.has-event')) as HTMLElement[];
        expect(eventCells.map(cell => cell.classList.contains('is-extinction'))).toEqual([false, true, false, false]);
        expect(eventCells.map(cell => cell.classList.contains('has-extinction-line'))).toEqual([false, true, false, false]);
    });

    it('keeps the timeline red after extinction when extinction is the last event', () => {
        const extinctEquipment = createEquipment('Extinct Final Test Equipment', {
            base: 'IS',
            rating: 'E',
            availability: { sl: 'E', sw: 'E', clan: 'E', da: 'E' },
            advancement: {
                is: { prototype: '2500', production: '2600', common: '2700', extinct: '2800' },
            },
        });
        const fixture = configureTimeline(extinctEquipment);

        const eventCells = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-cell.has-event')) as HTMLElement[];

        expect(eventCells.map(cell => cell.classList.contains('is-extinction'))).toEqual([false, false, false, true]);
        expect(eventCells.map(cell => cell.classList.contains('has-extinction-line'))).toEqual([false, false, false, true]);
    });

    it('aligns mixed IS and Clan timelines by globally sorted year slots', () => {
        const mixedEquipment = createEquipment('Mixed Timeline Test Equipment', {
            base: 'All',
            rating: 'E',
            availability: { sl: 'E', sw: 'E', clan: 'E', da: 'E' },
            advancement: {
                is: { prototype: '2500', production: '2600', common: '2700', extinct: '2800' },
                clan: { production: '2550', extinct: '2650', reintroduced: '2750', common: '2850' },
            },
        });
        const fixture = configureTimeline(mixedEquipment);

        const headerLabels = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-header-cell .label-long') as NodeListOf<HTMLElement>)
            .map(element => element.textContent?.trim());
        const timelineRows = Array.from(fixture.nativeElement.querySelectorAll('.advancement-timeline-row:not(.header)')) as HTMLElement[];
        const rowValues = timelineRows.map(row => Array.from(row.querySelectorAll('.advancement-timeline-value') as NodeListOf<HTMLElement>)
            .map(element => element.textContent?.trim()));
        const rowTracks = timelineRows.map(row => row.querySelector('.advancement-timeline-track') as HTMLElement);

        expect(headerLabels).toEqual(['Prototype', 'Production', 'Production', 'Extinction', 'Common', 'Reintroduction', 'Extinction', 'Common']);
        expect(rowValues).toEqual([
            ['2500', '2600', '2700', '2800'],
            ['2550', '2650', '2750', '2850'],
        ]);
        expect(rowTracks[0].querySelectorAll('.advancement-timeline-cell').length).toBe(8);
        expect(rowTracks[1].querySelectorAll('.advancement-timeline-cell').length).toBe(8);
        expect(rowTracks[0].style.gridTemplateColumns).toBe(rowTracks[1].style.gridTemplateColumns);
        const clanLineStates = Array.from(rowTracks[1].querySelectorAll('.advancement-timeline-cell') as NodeListOf<HTMLElement>)
            .map(cell => cell.classList.contains('has-extinction-line'));
        expect(clanLineStates).toEqual([false, false, false, true, true, false, false, false]);
    });
});