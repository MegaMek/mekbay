import { TestBed } from '@angular/core/testing';

import { TouchInputService } from './touch-input-service';

describe('TouchInputService', () => {
  let service: TouchInputService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TouchInputService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
