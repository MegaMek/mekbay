import { BreakpointObserver, Breakpoints, BreakpointState } from '@angular/cdk/layout';
import { computed, effect, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({
  providedIn: 'root'
})
export class BreakpointService{
  private breakpointObserver = inject(BreakpointObserver);
  readonly _breakpoint : Signal<BreakpointState | undefined> = toSignal(this.breakpointObserver
    .observe([Breakpoints.Large, Breakpoints.Medium, Breakpoints.Small, Breakpoints.XSmall]));

  private _isTiny: WritableSignal<boolean> = signal(false);
  public  isTiny : Signal<boolean> = this._isTiny.asReadonly();
  private _isHandset: WritableSignal<boolean> = signal(false);
  public isHandset : Signal<boolean> = this._isHandset.asReadonly();
  private _isTablet: WritableSignal<boolean> = signal(false);
  public isTablet : Signal<boolean> = this._isTablet.asReadonly();
  private _isWeb: WritableSignal<boolean> = signal(false);
  public isWeb: Signal<boolean> = computed(() => !this._isTablet() && !this.isHandset());
  public isMobile: Signal<boolean> = computed(() => this._isTablet() || this.isHandset());
  private _currentBreakpoint: WritableSignal<string> = signal('Unknown');
  public currentBreakpoint : Signal<string> = this._currentBreakpoint.asReadonly();

  constructor() {
    effect(() => {
        this.breakpointChecks(this._breakpoint());
    });
  }

  private breakpointChecks(breakpointState : BreakpointState | undefined): void {
    this._isTiny.set(this.breakpointObserver.isMatched(Breakpoints.XSmall))
    this._isHandset.set(!!this.breakpointObserver.isMatched(Breakpoints.Tablet));
    this._isTablet.set(!!this.breakpointObserver.isMatched(Breakpoints.Handset));
    this._isWeb.set(!!this.breakpointObserver.isMatched(Breakpoints.Web));
    if (this.breakpointObserver.isMatched(Breakpoints.Handset)) {
      this._currentBreakpoint.set('Handset');
    } else if (this.breakpointObserver.isMatched(Breakpoints.Tablet)) {
      this._currentBreakpoint.set('Tablet');
    } else if (this.breakpointObserver.isMatched(Breakpoints.Web)) {
      this._currentBreakpoint.set('Web');
    } else {
      this._currentBreakpoint.set('Unknown');
    }
  }
}