import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { APPROVAL_GATEWAY, CHAT_GATEWAY } from './application/ports';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: CHAT_GATEWAY, useValue: { send: async () => 'ok' } },
        {
          provide: APPROVAL_GATEWAY,
          useValue: { connect: () => () => {}, decide: async () => {} },
        },
      ],
    }).compileComponents();
  });

  it('renderiza la página de chat', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Asistente de atención al cliente',
    );
  });
});
