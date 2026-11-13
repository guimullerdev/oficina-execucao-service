import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../domain/enums/user-role.enum';
import { RolesGuard } from './roles.guard';

const ctxFor = (target: object, handler: () => void, user?: object) =>
  ({
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

class Ctl {
  @Roles(UserRole.ADMIN, 'CLIENTE')
  restricted() {}
  open() {}
  @Public()
  @Roles(UserRole.ADMIN)
  pub() {}
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows when role matches', () => {
    expect(
      guard.canActivate(
        ctxFor(Ctl, Ctl.prototype.restricted, { role: 'CLIENTE' }),
      ),
    ).toBe(true);
  });

  it('denies when role does not match', () => {
    expect(() =>
      guard.canActivate(
        ctxFor(Ctl, Ctl.prototype.restricted, { role: UserRole.MECANICO }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies when no user/role', () => {
    expect(() =>
      guard.canActivate(ctxFor(Ctl, Ctl.prototype.restricted)),
    ).toThrow(ForbiddenException);
  });

  it('allows when no roles required', () => {
    expect(guard.canActivate(ctxFor(Ctl, Ctl.prototype.open))).toBe(true);
  });

  it('allows public routes', () => {
    expect(guard.canActivate(ctxFor(Ctl, Ctl.prototype.pub))).toBe(true);
  });
});
