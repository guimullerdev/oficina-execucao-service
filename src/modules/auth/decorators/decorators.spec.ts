import { isCliente } from './current-user.decorator';

describe('isCliente', () => {
  it('detects CLIENTE role', () => {
    expect(isCliente({ sub: '1', role: 'CLIENTE' })).toBe(true);
    expect(isCliente({ sub: '1', role: 'ADMIN' as never })).toBe(false);
    expect(isCliente(undefined)).toBe(false);
  });
});
