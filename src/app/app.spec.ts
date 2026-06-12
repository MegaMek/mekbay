import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { App } from './app';
import { DataService } from './services/data.service';
import { ForceBuilderService } from './services/force-builder.service';
import { LayoutService } from './services/layout.service';
import { WsService } from './services/ws.service';
import { DialogsService } from './services/dialogs.service';
import { ToastService } from './services/toast.service';
import { OptionsService } from './services/options.service';
import { UnitSearchFiltersService } from './services/unit-search-filters.service';
import { GameService } from './services/game.service';
import { AccountAuthService } from './services/account-auth.service';
import { UrlService } from './services/url.service';
import { SavedSearchesService } from './services/saved-searches.service';
import { LoggerService } from './services/logger.service';
import { GameSystem } from './models/common.model';

describe('App', () => {
  const reloadHashStorageKey = 'mekbay:sw-update-reload-hash';
  const androidPwaBackExitStateKey = 'mekbayAndroidPwaBackExit';
  let versionUpdates: Subject<any>;
  let fixture: ReturnType<typeof TestBed.createComponent<App>> | null;
  let swUpdateMock: {
    isEnabled: boolean;
    versionUpdates: Subject<any>;
    checkForUpdate: jasmine.Spy<() => Promise<boolean>>;
    activateUpdate: jasmine.Spy<() => Promise<boolean>>;
  };
  let dataServiceMock: any;
  let forceBuilderServiceMock: any;
  let layoutServiceMock: any;
  let wsServiceMock: any;
  let dialogsServiceMock: any;
  let toastServiceMock: any;
  let optionsServiceMock: any;
  let unitSearchFiltersServiceMock: any;
  let gameServiceMock: any;
  let accountAuthServiceMock: any;
  let urlServiceMock: any;
  let savedSearchesServiceMock: any;
  let loggerServiceMock: any;

  beforeEach(async () => {
    versionUpdates = new Subject();
    fixture = null;
    swUpdateMock = {
      isEnabled: false,
      versionUpdates,
      checkForUpdate: jasmine.createSpy('checkForUpdate').and.resolveTo(false),
      activateUpdate: jasmine.createSpy('activateUpdate').and.resolveTo(true),
    };
    dataServiceMock = {
      initialize: jasmine.createSpy('initialize'),
      isDataReady: jasmine.createSpy('isDataReady').and.returnValue(false),
      ensureMegaMekAvailabilityCatalogInitialized: jasmine.createSpy('ensureMegaMekAvailabilityCatalogInitialized').and.resolveTo(false),
      isCloudForceLoading: jasmine.createSpy('isCloudForceLoading').and.returnValue(false),
      isDownloading: jasmine.createSpy('isDownloading').and.returnValue(false),
      getUnitByName: jasmine.createSpy('getUnitByName').and.returnValue(undefined),
      hasPendingCloudSaves: jasmine.createSpy('hasPendingCloudSaves').and.returnValue(false),
    };
    forceBuilderServiceMock = {
      hasForces: jasmine.createSpy('hasForces').and.returnValue(false),
      loadedForces: jasmine.createSpy('loadedForces').and.returnValue([]),
      loadForceFromUrlParams: jasmine.createSpy('loadForceFromUrlParams').and.resolveTo(undefined),
      showForceOrgDialog: jasmine.createSpy('showForceOrgDialog').and.resolveTo(undefined),
      showLoadForceDialog: jasmine.createSpy('showLoadForceDialog'),
      showForceGeneratorDialog: jasmine.createSpy('showForceGeneratorDialog').and.resolveTo(undefined),
      clear: jasmine.createSpy('clear').and.resolveTo(true),
    };
    layoutServiceMock = {
      isMenuOpen: jasmine.createSpy('isMenuOpen').and.returnValue(false),
      toggleMenu: jasmine.createSpy('toggleMenu'),
      closeMenu: jasmine.createSpy('closeMenu'),
    };
    wsServiceMock = {
      setGlobalErrorHandler: jasmine.createSpy('setGlobalErrorHandler'),
    };
    dialogsServiceMock = {
      createDialog: jasmine.createSpy('createDialog').and.returnValue({ componentInstance: null }),
      choose: jasmine.createSpy('choose').and.resolveTo('dismiss'),
      requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(false),
      showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
      showNextDialog: jasmine.createSpy('showNextDialog'),
    };
    toastServiceMock = {
      showToast: jasmine.createSpy('showToast'),
    };
    optionsServiceMock = {
      options: jasmine.createSpy('options').and.returnValue({ sheetsColor: 'day', availabilitySource: 'mekbay' }),
    };
    unitSearchFiltersServiceMock = {
      expandedView: jasmine.createSpy('expandedView').and.returnValue(false),
      setForeignTagDialogCallback: jasmine.createSpy('setForeignTagDialogCallback'),
      processPendingForeignTags: jasmine.createSpy('processPendingForeignTags'),
      applySearchParamsFromUrl: jasmine.createSpy('applySearchParamsFromUrl'),
    };
    gameServiceMock = {
      isAlphaStrike: jasmine.createSpy('isAlphaStrike').and.returnValue(false),
      setOverride: jasmine.createSpy('setOverride'),
      setMode: jasmine.createSpy('setMode'),
      currentGameSystem: jasmine.createSpy('currentGameSystem').and.returnValue(GameSystem.CLASSIC),
    };
    accountAuthServiceMock = {
      handleOAuthRedirectReturn: jasmine.createSpy('handleOAuthRedirectReturn').and.resolveTo(undefined),
    };
    urlServiceMock = {
      initialParams: new URLSearchParams(),
      initialPathname: '/',
      hasInitialParam: jasmine.createSpy('hasInitialParam').and.returnValue(false),
      getInitialParam: jasmine.createSpy('getInitialParam').and.returnValue(null),
      getGameSystemOverride: jasmine.createSpy('getGameSystemOverride').and.returnValue(null),
      setQueryParams: jasmine.createSpy('setQueryParams'),
    };
    savedSearchesServiceMock = {
      initialize: jasmine.createSpy('initialize'),
      registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
    };
    loggerServiceMock = {
      info: jasmine.createSpy('info'),
      warn: jasmine.createSpy('warn'),
      error: jasmine.createSpy('error'),
      handleError: jasmine.createSpy('handleError'),
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: SwUpdate,
          useValue: swUpdateMock,
        },
        { provide: DataService, useValue: dataServiceMock },
        { provide: ForceBuilderService, useValue: forceBuilderServiceMock },
        { provide: LayoutService, useValue: layoutServiceMock },
        { provide: WsService, useValue: wsServiceMock },
        { provide: DialogsService, useValue: dialogsServiceMock },
        { provide: ToastService, useValue: toastServiceMock },
        { provide: OptionsService, useValue: optionsServiceMock },
        { provide: UnitSearchFiltersService, useValue: unitSearchFiltersServiceMock },
        { provide: GameService, useValue: gameServiceMock },
        { provide: AccountAuthService, useValue: accountAuthServiceMock },
        { provide: UrlService, useValue: urlServiceMock },
        { provide: SavedSearchesService, useValue: savedSearchesServiceMock },
        { provide: LoggerService, useValue: loggerServiceMock },
      ]
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = null;
    localStorage.removeItem(reloadHashStorageKey);
    versionUpdates.complete();
  });

  it('should create the app', () => {
    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('suppresses auto reload when the same ready version already triggered a reload attempt', () => {
    localStorage.setItem(reloadHashStorageKey, 'hash-ready');
    swUpdateMock.isEnabled = true;

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'hash-old' },
      latestVersion: { hash: 'hash-ready' },
    });

    expect(app.updateAvailable()).toBeTrue();
    expect(app.updateAutoReloadEnabled()).toBeFalse();
  });

  it('snoozes update prompts for the current session when dismissed', () => {
    swUpdateMock.isEnabled = true;
    const now = 1000000;
    spyOn(Date, 'now').and.returnValue(now);

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'hash-old' },
      latestVersion: { hash: 'hash-ready' },
    });

    expect(app.updateAvailable()).toBeTrue();
    expect(app.updateAutoReloadEnabled()).toBeTrue();

    app.dismissUpdatePromptForSession();

    expect(app.updateAvailable()).toBeFalse();
    expect(app.updateAutoReloadEnabled()).toBeFalse();
    expect(app.lastUpdateCheck).toBeGreaterThan(now);

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'hash-old' },
      latestVersion: { hash: 'hash-ready' },
    });

    expect(app.updateAvailable()).toBeFalse();
  });

  it('activates a pending service worker update before reloading', async () => {
    swUpdateMock.isEnabled = true;

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    spyOn(app, 'performPageReload');
    app.pendingUpdateHash = 'hash-ready';

    await app.reloadForUpdate();

    expect(swUpdateMock.activateUpdate).toHaveBeenCalled();
    expect(localStorage.getItem(reloadHashStorageKey)).toBe('hash-ready');
    expect(app.performPageReload).toHaveBeenCalled();
  });

  it('adds a synthetic Android standalone PWA back history entry', () => {
    spyOnProperty(window.navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (Linux; Android 14)');
    spyOn(window, 'matchMedia').and.callFake((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    }) as MediaQueryList);
    const pushStateSpy = spyOn(window.history, 'pushState');

    fixture = TestBed.createComponent(App);

    expect(pushStateSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ [androidPwaBackExitStateKey]: true }),
      '',
      window.location.href
    );
  });

  it('closes the Android standalone PWA window when back reaches the app root', () => {
    spyOnProperty(window.navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (Linux; Android 14)');
    spyOn(window, 'matchMedia').and.callFake((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    }) as MediaQueryList);
    spyOn(window.history, 'pushState');
    const forwardSpy = spyOn(window.history, 'forward');

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    spyOn(app, 'closeStandaloneWindow');

    app.androidPwaBackExitHandler(new PopStateEvent('popstate', { state: null }));

    expect(forwardSpy).toHaveBeenCalled();
    expect(app.closeStandaloneWindow).toHaveBeenCalled();
  });
});
