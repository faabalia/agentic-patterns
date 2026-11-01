import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpChatGateway } from './chat-http.gateway';
import { ChatGatewayError } from '../domain/chat';

describe('HttpChatGateway', () => {
  let gateway: HttpChatGateway;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HttpChatGateway, provideHttpClient(), provideHttpClientTesting()],
    });
    gateway = TestBed.inject(HttpChatGateway);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('envía el mensaje por POST y devuelve la respuesta', async () => {
    const promise = gateway.send('¿Cuánto era la factura INV-1001?');
    const req = http.expectOne('/api/chat');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ message: '¿Cuánto era la factura INV-1001?' });

    req.flush({ reply: 'Son 120 €.' });
    await expect(promise).resolves.toBe('Son 120 €.');
  });

  it('traduce 409 a un error de turno en curso', async () => {
    const promise = gateway.send('hola');
    http.expectOne('/api/chat').flush(null, { status: 409, statusText: 'Conflict' });

    await expect(promise).rejects.toBeInstanceOf(ChatGatewayError);
    await expect(promise).rejects.toThrow('Ya hay un mensaje en curso.');
  });

  it('traduce 400 y 413 a mensajes seguros', async () => {
    const invalid = gateway.send('hola');
    http.expectOne('/api/chat').flush(null, { status: 400, statusText: 'Bad Request' });
    await expect(invalid).rejects.toThrow('Mensaje no válido.');

    const tooLarge = gateway.send('hola');
    http.expectOne('/api/chat').flush(null, { status: 413, statusText: 'Payload Too Large' });
    await expect(tooLarge).rejects.toThrow('El mensaje es demasiado largo.');
  });

  it('oculta detalles internos en errores de red o servidor', async () => {
    const network = gateway.send('hola');
    http.expectOne('/api/chat').error(new ProgressEvent('error'));
    await expect(network).rejects.toThrow('No se pudo contactar con el asistente.');

    const server = gateway.send('hola');
    http.expectOne('/api/chat').flush({ error: 'stack trace interno' }, { status: 500, statusText: 'Error' });
    await expect(server).rejects.toThrow('No se pudo contactar con el asistente.');
  });
});
