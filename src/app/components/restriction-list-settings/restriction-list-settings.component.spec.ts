import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { RestrictionListDefinition } from '../../models/restriction-lists.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { RestrictionListsService } from '../../services/restriction-lists.service';
import { ToastService } from '../../services/toast.service';
import { RestrictionListSettingsComponent } from './restriction-list-settings.component';

function createRestrictionList(overrides: Partial<RestrictionListDefinition> = {}): RestrictionListDefinition {
    const gameSystem = overrides.gameSystem ?? GameSystem.CLASSIC;

    return {
        slug: overrides.slug ?? 'custom-local-test',
        name: overrides.name ?? 'Local Restriction Test',
        description: overrides.description ?? 'Local restriction profile',
        updatedAt: overrides.updatedAt ?? '2026-04-15T00:00:00.000Z',
        gameSystem,
        catalog: {
            allowClassicUnitTypes: overrides.catalog?.allowClassicUnitTypes ?? ['Mek'],
            allowClassicUnitSubtypes: overrides.catalog?.allowClassicUnitSubtypes ?? ['BattleMek'],
            allowAlphaStrikeUnitTypes: overrides.catalog?.allowAlphaStrikeUnitTypes ?? [],
            requireCanon: overrides.catalog?.requireCanon ?? false,
            forbidQuirks: overrides.catalog?.forbidQuirks ?? false,
            forbidAmmoTypes: overrides.catalog?.forbidAmmoTypes ?? [],
            forbidArrowIVHoming: overrides.catalog?.forbidArrowIVHoming ?? false,
        },
        roster: {
            minUnits: overrides.roster?.minUnits ?? 3,
            maxUnits: overrides.roster?.maxUnits ?? 6,
            uniqueChassis: overrides.roster?.uniqueChassis ?? false,
            maxUnitsWithJumpAtLeast: overrides.roster?.maxUnitsWithJumpAtLeast,
        },
        live: overrides.live ?? (gameSystem === GameSystem.CLASSIC
            ? {
                classic: {
                    crewSkillMin: 0,
                    crewSkillMax: 5,
                    maxGunneryPilotingDelta: 1,
                },
            }
            : {
                alphaStrike: {
                    allowManualPilotAbilities: true,
                    allowFormationAbilities: true,
                },
            }),
        notes: overrides.notes ?? ['Stored locally'],
    };
}

describe('RestrictionListSettingsComponent', () => {
    let restrictionListsState: ReturnType<typeof signal<RestrictionListDefinition[]>>;
    let restrictionListsServiceStub: {
        availableRestrictionLists: ReturnType<typeof restrictionListsState.asReadonly>;
        getActiveRestrictionLists: jasmine.Spy;
        getRestrictionListBySlug: jasmine.Spy;
        createCustomRestrictionList: jasmine.Spy;
        duplicateRestrictionList: jasmine.Spy;
        saveCustomRestrictionList: jasmine.Spy;
        deleteCustomRestrictionList: jasmine.Spy;
        clearActiveRestrictions: jasmine.Spy;
        isRestrictionSlugActive: jasmine.Spy;
        toggleActiveRestrictionSlug: jasmine.Spy;
    };
    let toastServiceStub: { showToast: jasmine.Spy };

    beforeEach(async () => {
        restrictionListsState = signal<RestrictionListDefinition[]>([
            createRestrictionList(),
        ]);

        restrictionListsServiceStub = {
            availableRestrictionLists: restrictionListsState.asReadonly(),
            getActiveRestrictionLists: jasmine.createSpy('getActiveRestrictionLists').and.returnValue([]),
            getRestrictionListBySlug: jasmine.createSpy('getRestrictionListBySlug').and.callFake((slug: string | null | undefined) => {
                if (!slug) {
                    return null;
                }

                return restrictionListsState().find((list) => list.slug === slug) ?? null;
            }),
            createCustomRestrictionList: jasmine.createSpy('createCustomRestrictionList').and.callFake((gameSystem: GameSystem) => {
                const next = createRestrictionList({
                    slug: 'custom-created-test',
                    name: 'New Restriction List',
                    gameSystem,
                });
                restrictionListsState.set([...restrictionListsState(), next]);
                return next;
            }),
            duplicateRestrictionList: jasmine.createSpy('duplicateRestrictionList').and.returnValue(null),
            saveCustomRestrictionList: jasmine.createSpy('saveCustomRestrictionList').and.callFake((list: RestrictionListDefinition) => {
                const nextLists = [...restrictionListsState()];
                const existingIndex = nextLists.findIndex((entry) => entry.slug === list.slug);
                if (existingIndex >= 0) {
                    nextLists.splice(existingIndex, 1, list);
                } else {
                    nextLists.push(list);
                }

                restrictionListsState.set(nextLists);
            }),
            deleteCustomRestrictionList: jasmine.createSpy('deleteCustomRestrictionList').and.callFake((slug: string) => {
                restrictionListsState.set(restrictionListsState().filter((list) => list.slug !== slug));
            }),
            clearActiveRestrictions: jasmine.createSpy('clearActiveRestrictions'),
            isRestrictionSlugActive: jasmine.createSpy('isRestrictionSlugActive').and.returnValue(false),
            toggleActiveRestrictionSlug: jasmine.createSpy('toggleActiveRestrictionSlug'),
        };

        toastServiceStub = {
            showToast: jasmine.createSpy('showToast'),
        };

        await TestBed.configureTestingModule({
            imports: [RestrictionListSettingsComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: DataService,
                    useValue: {
                        searchCorpusVersion: signal(0),
                        getUnits: () => [
                            { type: 'Mek', subtype: 'BattleMek', as: { TP: 'BM' } },
                            { type: 'Tank', subtype: 'Hover', as: { TP: 'CV' } },
                        ],
                    },
                },
                { provide: RestrictionListsService, useValue: restrictionListsServiceStub },
                { provide: DialogsService, useValue: { requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(true) } },
                { provide: GameService, useValue: { currentGameSystem: signal(GameSystem.CLASSIC) } },
                { provide: ToastService, useValue: toastServiceStub },
            ],
        }).compileComponents();
    });

    it('coerces numeric editor input values before computing dirty state and saving', () => {
        const fixture = TestBed.createComponent(RestrictionListSettingsComponent);
        fixture.detectChanges();

        const component = fixture.componentInstance;

        component.updateMinUnits(4);
        component.updateMaxUnits(8);
        component.updateJumpRuleEnabled(true);
        component.updateJumpMinimum(2);
        component.updateJumpMaxUnits(1);
        component.updateCrewSkillMin(1);
        component.updateCrewSkillMax(3);
        component.updateMaxGunneryPilotingDelta(2);

        expect(component.hasDraftChanges()).toBeTrue();
        expect(() => component.saveSelectedList()).not.toThrow();

        const saved = restrictionListsServiceStub.saveCustomRestrictionList.calls.mostRecent().args[0] as RestrictionListDefinition;
        expect(saved.roster?.minUnits).toBe(4);
        expect(saved.roster?.maxUnits).toBe(8);
        expect(saved.roster?.maxUnitsWithJumpAtLeast).toEqual({ minimumJump: 2, maxUnits: 1 });
        expect(saved.live?.classic).toEqual({
            crewSkillMin: 1,
            crewSkillMax: 3,
            maxGunneryPilotingDelta: 2,
        });
        expect(toastServiceStub.showToast).toHaveBeenCalledWith('Saved Local Restriction Test.', 'success');
    });

    it('persists edited catalog rules and notes when saving', () => {
        const fixture = TestBed.createComponent(RestrictionListSettingsComponent);
        fixture.detectChanges();

        const component = fixture.componentInstance;

        component.updateClassicUnitTypes([' Tank ', 'Mek', 'tank']);
        component.updateClassicUnitSubtypes([' Hover ', 'BattleMek', 'hover']);
        component.updateRequireCanon(true);
        component.updateForbidQuirks(true);
        component.updateNotesText(' First note\n\nSecond note ');
        component.saveSelectedList();

        const saved = restrictionListsServiceStub.saveCustomRestrictionList.calls.mostRecent().args[0] as RestrictionListDefinition;
        expect(saved.catalog?.allowClassicUnitTypes).toEqual(['Tank', 'Mek']);
        expect(saved.catalog?.allowClassicUnitSubtypes).toEqual(['Hover', 'BattleMek']);
        expect(saved.catalog?.requireCanon).toBeTrue();
        expect(saved.catalog?.forbidQuirks).toBeTrue();
        expect(saved.notes).toEqual(['First note', 'Second note']);
    });
});