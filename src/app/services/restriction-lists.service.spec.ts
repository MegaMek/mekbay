import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../models/common.model';
import type { RestrictionListDefinition } from '../models/restriction-lists.model';
import { RestrictionListsService } from './restriction-lists.service';
import { UrlStateService } from './url-state.service';

const CUSTOM_RESTRICTION_LISTS_STORAGE_KEY = 'mekbay:custom-restriction-lists';

function createStoredRestrictionList(slug: string): RestrictionListDefinition {
    return {
        slug,
        name: 'Local Restriction Test',
        description: 'Local restriction profile',
        updatedAt: '2026-04-15T00:00:00.000Z',
        gameSystem: GameSystem.CLASSIC,
        catalog: {
            allowClassicUnitTypes: ['Mek'],
            allowClassicUnitSubtypes: ['BattleMek'],
            allowAlphaStrikeUnitTypes: [],
            requireCanon: true,
            forbidQuirks: true,
            forbidAmmoTypes: [],
            forbidArrowIVHoming: false,
        },
        roster: {
            minUnits: 3,
            maxUnits: 6,
            uniqueChassis: true,
        },
        live: {
            classic: {
                crewSkillMin: 0,
                crewSkillMax: 5,
                maxGunneryPilotingDelta: 1,
            },
        },
        notes: ['Stored locally'],
    };
}

describe('RestrictionListsService', () => {
    let service: RestrictionListsService;

    beforeEach(() => {
        localStorage.clear();
        history.replaceState({}, '', '/');

        TestBed.configureTestingModule({
            providers: [
                UrlStateService,
                RestrictionListsService,
                { provide: Location, useValue: { replaceState: jasmine.createSpy('replaceState') } },
            ],
        });
    });

    afterEach(() => {
        localStorage.clear();
        history.replaceState({}, '', '/');
    });

    it('rehydrates local custom restriction slugs from the url param', () => {
        const storedList = createStoredRestrictionList('custom-local-test');
        localStorage.setItem(CUSTOM_RESTRICTION_LISTS_STORAGE_KEY, JSON.stringify([storedList]));
        history.replaceState({}, '', '/?rl=custom-local-test,retired-built-in-slug');

        service = TestBed.inject(RestrictionListsService);

        const activeLists = service.getActiveRestrictionLists(GameSystem.CLASSIC);

        expect(activeLists.map((list) => list.slug)).toEqual(['custom-local-test']);
        expect(service.getRestrictionListBySlug('custom-local-test')?.name).toBe('Local Restriction Test');
    });

    it('persists and removes custom restriction lists locally', () => {
        service = TestBed.inject(RestrictionListsService);

        const created = service.createCustomRestrictionList(GameSystem.ALPHA_STRIKE);
        service.toggleActiveRestrictionSlug(created.slug, true);

        const storedAfterCreate = JSON.parse(localStorage.getItem(CUSTOM_RESTRICTION_LISTS_STORAGE_KEY) ?? '[]') as RestrictionListDefinition[];

        expect(storedAfterCreate.some((list) => list.slug === created.slug)).toBeTrue();
        expect(service.activeRestrictionSlugs()).toContain(created.slug);

        service.deleteCustomRestrictionList(created.slug);

        const storedAfterDelete = JSON.parse(localStorage.getItem(CUSTOM_RESTRICTION_LISTS_STORAGE_KEY) ?? '[]') as RestrictionListDefinition[];

        expect(storedAfterDelete.some((list) => list.slug === created.slug)).toBeFalse();
        expect(service.activeRestrictionSlugs()).not.toContain(created.slug);
    });

    it('migrates legacy allowUnitTypes rules into Classic type pills', () => {
        const legacyList = {
            ...createStoredRestrictionList('legacy-custom-local-test'),
            catalog: {
                allowUnitTypes: ['Mek'],
                requireCanon: true,
                forbidQuirks: false,
                forbidAmmoTypes: [],
                forbidArrowIVHoming: false,
            },
        } as unknown as RestrictionListDefinition;

        localStorage.setItem(CUSTOM_RESTRICTION_LISTS_STORAGE_KEY, JSON.stringify([legacyList]));

        service = TestBed.inject(RestrictionListsService);

        expect(service.getRestrictionListBySlug('legacy-custom-local-test')?.catalog?.allowClassicUnitTypes).toEqual(['Mek']);
    });
});