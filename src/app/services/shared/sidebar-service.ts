import { Injectable, Signal, signal, WritableSignal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SidebarService {

  private _isOpen: WritableSignal<boolean> = signal(false);
  public isOpen : Signal<boolean> = this._isOpen.asReadonly();

  toggleMenu() : void  {
    this._isOpen.set(!this._isOpen());
  }

  openMenu() : void  {
    this._isOpen.set(true);
  }

  closeMenu() : void {
    this._isOpen.set(false);
  }
}
