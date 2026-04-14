import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { App } from './app';

describe('App', () => {
  const reloadHashStorageKey = 'mekbay:sw-update-reload-hash';
  let versionUpdates: Subject<any>;
  let swUpdateMock: {
    isEnabled: boolean;
    versionUpdates: Subject<any>;
    checkForUpdate: jasmine.Spy<() => Promise<boolean>>;
    activateUpdate: jasmine.Spy<() => Promise<boolean>>;
  };

  beforeEach(async () => {
    versionUpdates = new Subject();
    swUpdateMock = {
      isEnabled: false,
      versionUpdates,
      checkForUpdate: jasmine.createSpy('checkForUpdate').and.resolveTo(false),
      activateUpdate: jasmine.createSpy('activateUpdate').and.resolveTo(true),
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: SwUpdate,
          useValue: swUpdateMock,
        },
      ]
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem(reloadHashStorageKey);
    versionUpdates.complete();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('suppresses auto reload when the same ready version already triggered a reload attempt', () => {
    localStorage.setItem(reloadHashStorageKey, 'hash-ready');
    swUpdateMock.isEnabled = true;

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'hash-old' },
      latestVersion: { hash: 'hash-ready' },
    });

    expect(app.updateAvailable()).toBeTrue();
    expect(app.updateAutoReloadEnabled()).toBeFalse();
  });

  it('activates a pending service worker update before reloading', async () => {
    swUpdateMock.isEnabled = true;

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    spyOn(app, 'performPageReload');
    app.pendingUpdateHash = 'hash-ready';

    await app.reloadForUpdate();

    expect(swUpdateMock.activateUpdate).toHaveBeenCalled();
    expect(localStorage.getItem(reloadHashStorageKey)).toBe('hash-ready');
    expect(app.performPageReload).toHaveBeenCalled();
  });
});
