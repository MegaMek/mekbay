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

  private _isHandset: WritableSignal<boolean> = signal(false);
  public isHandset : Signal<boolean> = this._isHandset.asReadonly();
  private _isTabletPortrait: WritableSignal<boolean> = signal(false);
  public isTabletPortrait : Signal<boolean> = this._isTabletPortrait.asReadonly();
  public isMobile: Signal<boolean> = computed(() => this._isTabletPortrait() || this.isHandset());

  constructor() {
    effect(() => {
        this.breakpointChecks(this._breakpoint());
    });

    effect(() => {
      document.documentElement.classList.toggle('mobile-mode', this.isMobile());
    });
  }

  private breakpointChecks(breakpointState : BreakpointState | undefined): void {
    this._isHandset.set(!!this.breakpointObserver.isMatched(Breakpoints.Handset));
    this._isTabletPortrait.set(!!this.breakpointObserver.isMatched(Breakpoints.TabletPortrait));
  }
}