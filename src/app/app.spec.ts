// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OverlayContainer } from '@angular/cdk/overlay';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { App } from './app';
import { DataService } from './services/data.service';
import { ForcePersistenceService } from './services/force-persistence.service';
import { ForceImportService } from './services/force-import.service';
import { ForceDialogsService } from './services/force-dialogs.service';
import { ForceWorkspaceStateService } from './services/force-workspace-state.service';
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
import { AppUpdateService } from './services/app-update.service';
import { UnitSearchComponent } from './components/unit-search/unit-search.component';
import { LobbyService } from './services/lobby.service';

@Component({
  selector: 'unit-search',
  template: '',
})
class UnitSearchStubComponent {}

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
  let forcePersistenceServiceMock: any;
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
  let lobbyServiceMock: any;

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
      forceNeedsAdoption: new Subject(),
      isDataReady: signal(false),
      unitCatalogState: signal({ status: 'idle', availableUnits: 0 }),
      runtimeCatalogProgress: signal({ status: 'idle' }),
      auxiliaryCatalogProgress: signal({ status: 'idle' }),
      ensureMegaMekAvailabilityCatalogInitialized: jasmine.createSpy('ensureMegaMekAvailabilityCatalogInitialized').and.resolveTo(false),
      getUnitByName: jasmine.createSpy('getUnitByName').and.returnValue(undefined),
    };
    forcePersistenceServiceMock = {
      isCloudForceLoading: signal(false),
      hasPendingForceSaves: jasmine.createSpy('hasPendingForceSaves').and.returnValue(false),
    };
    forceBuilderServiceMock = {
      hasForces: jasmine.createSpy('hasForces').and.returnValue(false),
      allLoadedUnits: signal([]),
      loadedForces: jasmine.createSpy('loadedForces').and.returnValue([]),
      loadForceFromUrlParams: jasmine.createSpy('loadForceFromUrlParams').and.resolveTo(undefined),
      showForceOrgDialog: jasmine.createSpy('showForceOrgDialog').and.resolveTo(undefined),
      showLoadForceDialog: jasmine.createSpy('showLoadForceDialog'),
      showForceGeneratorDialog: jasmine.createSpy('showForceGeneratorDialog').and.resolveTo(undefined),
      clear: jasmine.createSpy('clear').and.resolveTo(true),
    };
    layoutServiceMock = {
      isMenuOpen: jasmine.createSpy('isMenuOpen').and.returnValue(false),
      windowWidth: signal(1280),
      windowHeight: signal(800),
      toggleMenu: jasmine.createSpy('toggleMenu'),
      closeMenu: jasmine.createSpy('closeMenu'),
    };
    wsServiceMock = {
      connectionStatusPhase: signal('hidden'),
      setGlobalErrorHandler: jasmine.createSpy('setGlobalErrorHandler'),
      registerMessageHandler: jasmine.createSpy('registerMessageHandler').and.returnValue(() => {}),
      registerServerMessageHandler: jasmine.createSpy('registerServerMessageHandler').and.returnValue(() => {}),
    };
    dialogsServiceMock = {
      createDialog: jasmine.createSpy('createDialog').and.returnValue({ componentInstance: null }),
      choose: jasmine.createSpy('choose').and.resolveTo('dismiss'),
      requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(false),
      showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
      showNextDialog: jasmine.createSpy('showNextDialog'),
    };
    toastServiceMock = {
      toasts: signal([]),
      visibleToasts: signal([]),
      showToast: jasmine.createSpy('showToast'),
      dismiss: jasmine.createSpy('dismiss'),
    };
    optionsServiceMock = {
      options: jasmine.createSpy('options').and.returnValue({ colorScheme: 'default', availabilitySource: 'mul' }),
    };
    unitSearchFiltersServiceMock = {
      expandedView: jasmine.createSpy('expandedView').and.returnValue(false),
      advOpen: signal(false),
      workerCatalogProgress: signal({ status: 'idle' }),
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
    lobbyServiceMock = {
      hasLobby: jasmine.createSpy('hasLobby').and.returnValue(false),
      promptAndJoin: jasmine.createSpy('promptAndJoin').and.resolveTo(undefined),
      showLobbyDialog: jasmine.createSpy('showLobbyDialog').and.resolveTo(undefined),
      confirmAndLeave: jasmine.createSpy('confirmAndLeave').and.resolveTo(false),
    };

    TestBed.overrideComponent(App, {
      remove: { imports: [UnitSearchComponent] },
      add: { imports: [UnitSearchStubComponent] },
    });
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
        { provide: ForcePersistenceService, useValue: forcePersistenceServiceMock },
        { provide: ForceWorkspaceStateService, useValue: forceBuilderServiceMock },
        { provide: ForceImportService, useValue: forceBuilderServiceMock },
        { provide: ForceDialogsService, useValue: forceBuilderServiceMock },
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
        { provide: LobbyService, useValue: lobbyServiceMock },
      ]
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = null;
    document.querySelectorAll('.mekbay-bootstrap-update-screen').forEach((element) => element.remove());
    localStorage.removeItem(reloadHashStorageKey);
    versionUpdates.complete();
  });

  it('should create the app', () => {
    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('blocks unload while serialization, local persistence, or cloud acknowledgement is pending', () => {
    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as BeforeUnloadEvent;
    forcePersistenceServiceMock.hasPendingForceSaves.and.returnValue(true);

    expect(app.beforeUnloadHandler(event)).toBe('You have unsaved changes. Are you sure you want to leave?');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(forcePersistenceServiceMock.hasPendingForceSaves).toHaveBeenCalled();
  });

  it('allows unload once the full force-save pipeline is settled', () => {
    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as BeforeUnloadEvent;

    expect(app.beforeUnloadHandler(event)).toBeUndefined();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps the application interactive and reserves a global bottom status row', async () => {
    fixture = TestBed.createComponent(App);
    dataServiceMock.unitCatalogState.set({
      status: 'loading',
      availableUnits: 0,
      progress: { phase: 'local-generation', completed: 0, total: 1 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const surface = host.querySelector('.application-surface') as HTMLElement;
    const viewport = host.querySelector('.application-viewport') as HTMLElement;
    expect(surface.hasAttribute('inert')).toBeFalse();
    expect(surface.hasAttribute('aria-hidden')).toBeFalse();
    expect(host.querySelector('.catalog-startup-blocker')).toBeNull();
    expect(host.querySelector('startup-progress')).toBeNull();
    const coldStatus = host.querySelector('catalog-refresh-status [role="status"]') as HTMLElement;
    expect(coldStatus?.getAttribute('aria-live')).toBe('polite');
    expect(coldStatus?.getAttribute('aria-busy')).toBe('true');
    expect(surface.contains(coldStatus)).toBeTrue();
    expect(viewport.contains(coldStatus)).toBeFalse();
    expect(TestBed.inject(OverlayContainer).getContainerElement().parentElement).toBe(viewport);

    dataServiceMock.isDataReady.set(true);
    dataServiceMock.unitCatalogState.set({
      status: 'loading',
      availableUnits: 10_990,
      progress: { phase: 'dependency-validation', completed: 2, total: 7 },
    });
    fixture.detectChanges();

    const backgroundStatus = host.querySelector('catalog-refresh-status [role="status"]') as HTMLElement;
    expect(backgroundStatus?.getAttribute('aria-live')).toBe('polite');
    expect(backgroundStatus?.getAttribute('aria-busy')).toBe('true');
    expect(surface.contains(backgroundStatus)).toBeTrue();

    dataServiceMock.unitCatalogState.set({
      status: 'error',
      availableUnits: 10_990,
      error: 'HTTP 404',
    });
    fixture.detectChanges();

    const warningStatus = host.querySelector('catalog-refresh-status .warning[role="status"]') as HTMLElement;
    expect(warningStatus?.getAttribute('aria-busy')).toBe('false');
    expect(surface.hasAttribute('inert')).toBeFalse();

    dataServiceMock.unitCatalogState.set({ status: 'ready', availableUnits: 10_990 });
    fixture.detectChanges();

    expect(host.querySelector('catalog-refresh-status [role="status"]')).toBeNull();
  });

  it('projects exact core phase progress before and after local data becomes ready', () => {
    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    expect(app.backgroundCatalogProgress()).toEqual({ kind: 'hidden' });

    dataServiceMock.unitCatalogState.set({
      status: 'loading',
      availableUnits: 0,
      progress: { phase: 'projecting', completed: 250, total: 1000 },
    });
    expect(app.backgroundCatalogProgress()).toEqual(jasmine.objectContaining({
      kind: 'progress',
      mode: 'determinate',
      completed: 250,
      total: 1000,
      percent: 25,
    }));

    dataServiceMock.isDataReady.set(true);
    dataServiceMock.unitCatalogState.set({
      status: 'loading',
      availableUnits: 10_990,
      progress: { phase: 'projecting', completed: 250, total: 1000 },
    });
    expect(app.backgroundCatalogProgress()).toEqual(jasmine.objectContaining({
      kind: 'progress',
      mode: 'determinate',
      percent: 25,
            title: 'Updating catalogs…',
    }));

    dataServiceMock.unitCatalogState.set({
      status: 'error',
      availableUnits: 10_990,
      error: 'HTTP 404',
    });
    expect(app.backgroundCatalogProgress()).toEqual(jasmine.objectContaining({
      kind: 'notice',
      tone: 'warning',
    }));

    dataServiceMock.unitCatalogState.set({ status: 'ready', availableUnits: 10_990 });
    expect(app.backgroundCatalogProgress()).toEqual({ kind: 'hidden' });
  });

  it('does not check for service worker updates immediately after full app startup', () => {
    swUpdateMock.isEnabled = true;

    fixture = TestBed.createComponent(App);

    expect(swUpdateMock.checkForUpdate).not.toHaveBeenCalled();
  });

  it('marks a service worker update as pending without activating it immediately', () => {
    swUpdateMock.isEnabled = true;

    fixture = TestBed.createComponent(App);
    const appUpdateService = TestBed.inject(AppUpdateService);

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'hash-old' },
      latestVersion: { hash: 'hash-ready' },
    });

    expect(appUpdateService.updatePending()).toBeTrue();
    expect(swUpdateMock.activateUpdate).not.toHaveBeenCalled();
  });

  it('checks for updates on focus and online only when the ten-minute update-check clock is due', async () => {
    swUpdateMock.isEnabled = true;
    const startTime = 1_000_000;
    const nowSpy = spyOn(Date, 'now').and.returnValue(startTime);
    const flushUpdateCheck = async () => {
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
    };

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const appUpdateService = TestBed.inject(AppUpdateService);
    const scheduleUpdateCheckTimerSpy = spyOn(app, 'scheduleUpdateCheckTimer').and.callThrough();

    app.onFocus();
    await flushUpdateCheck();
    expect(swUpdateMock.checkForUpdate).not.toHaveBeenCalled();
    expect(scheduleUpdateCheckTimerSpy).not.toHaveBeenCalled();

    nowSpy.and.returnValue(startTime + appUpdateService.focusUpdateCheckIntervalMs + 1);
    app.onFocus();
    await swUpdateMock.checkForUpdate.calls.mostRecent().returnValue;
    await flushUpdateCheck();

    expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateCheckTimerSpy).toHaveBeenCalled();

    nowSpy.and.returnValue(startTime + appUpdateService.focusUpdateCheckIntervalMs + 2);
    app.onOnline();
    await flushUpdateCheck();

    expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('restarts to install an already pending update after six hours without focus', () => {
    swUpdateMock.isEnabled = true;
    const startTime = 1_000_000;
    spyOn(Date, 'now').and.returnValue(startTime + (6 * 60 * 60 * 1000) + 1);

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const appUpdateService = TestBed.inject(AppUpdateService);
    const restartSpy = spyOn(appUpdateService, 'restartForUpdate').and.resolveTo();

    app.focusLostAt = startTime;
    appUpdateService.updatePending.set(true);
    app.onFocus();

    expect(restartSpy).toHaveBeenCalled();
    expect(swUpdateMock.checkForUpdate).not.toHaveBeenCalled();
  });

  it('keeps focus recovery passive after six hours when no update is pending', async () => {
    swUpdateMock.isEnabled = true;
    const startTime = 1_000_000;
    const nowSpy = spyOn(Date, 'now').and.returnValue(startTime);

    fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const appUpdateService = TestBed.inject(AppUpdateService);
    const restartSpy = spyOn(appUpdateService, 'restartForUpdate').and.resolveTo();

    app.focusLostAt = startTime;
    nowSpy.and.returnValue(startTime + (6 * 60 * 60 * 1000) + 1);
    app.onFocus();
    await Promise.resolve();

    expect(restartSpy).not.toHaveBeenCalled();
    expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(1);
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
