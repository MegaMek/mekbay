import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TagSelectorComponent, type TagQuantityChangeEvent } from './tag-selector.component';

describe('TagSelectorComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TagSelectorComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();
    });

    function renderAssignedNameTag(quantity = 1) {
        const fixture = TestBed.createComponent(TagSelectorComponent);
        const component = fixture.componentInstance;
        component.nameTags.set(['Alpha']);
        component.assignedNameTags.set(['Alpha']);
        component.nameTagQuantities.set({ alpha: quantity });
        fixture.detectChanges();

        const input = fixture.nativeElement.querySelector('.tag-quantity-input') as HTMLInputElement;
        return { component, fixture, input };
    }

    function renderAssignedChassisTag(quantity = 1) {
        const fixture = TestBed.createComponent(TagSelectorComponent);
        const component = fixture.componentInstance;
        component.chassisTags.set(['Beta']);
        component.assignedChassisTags.set(['Beta']);
        component.chassisTagQuantities.set({ beta: quantity });
        fixture.detectChanges();

        const input = fixture.nativeElement.querySelector('.tag-quantity-input') as HTMLInputElement;
        return { component, fixture, input };
    }

    it('allows clearing a name tag quantity while editing', () => {
        const { component, fixture, input } = renderAssignedNameTag();

        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        fixture.detectChanges();

        expect(input.value).toBe('');
        expect(component.nameTagQuantities()['alpha']).toBe(1);
    });

    it('commits an empty name tag quantity as 1 on blur', () => {
        const { component, fixture, input } = renderAssignedNameTag();
        const events: TagQuantityChangeEvent[] = [];
        const subscription = component.quantityChanged.subscribe(event => events.push(event));

        input.value = '';
        input.dispatchEvent(new Event('blur'));
        fixture.detectChanges();

        expect(input.value).toBe('1');
        expect(component.nameTagQuantities()['alpha']).toBe(1);
        expect(events).toEqual([{ tag: 'Alpha', tagType: 'name', quantity: 1 }]);

        subscription.unsubscribe();
    });

    it('commits a chassis tag quantity after clearing and typing a new number', () => {
        const { component, fixture, input } = renderAssignedChassisTag();
        const events: TagQuantityChangeEvent[] = [];
        const subscription = component.quantityChanged.subscribe(event => events.push(event));

        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        fixture.detectChanges();

        input.value = '2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        fixture.detectChanges();

        input.dispatchEvent(new Event('blur'));
        fixture.detectChanges();

        expect(input.value).toBe('2');
        expect(component.chassisTagQuantities()['beta']).toBe(2);
        expect(events).toEqual([{ tag: 'Beta', tagType: 'chassis', quantity: 2 }]);

        subscription.unsubscribe();
    });
});