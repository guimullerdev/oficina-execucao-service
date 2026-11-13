import { UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { AuthModule } from '../auth.module';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'test-secret';

const makeContext = (
  authHeader?: string,
  target: object = class {},
  handler: () => void = () => undefined,
) => {
  const request: { headers: object; user?: unknown } = {
    headers: { authorization: authHeader },
  };
  return {
    request,
    ctx: {
      getHandler: () => handler,
      getClass: () => target,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  };
};

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({});
  const config = {
    get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined),
  };
  const guard = new JwtAuthGuard(jwt, new Reflector(), config as never);
  const payload = { sub: 'u-1', email: 'a@b.com', role: 'ADMIN' };

  it('401 when no token', async () => {
    await expect(guard.canActivate(makeContext().ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('401 on malformed header', async () => {
    await expect(
      guard.canActivate(makeContext('Basic abc').ctx),
    ).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(makeContext('Bearer').ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('401 on bad signature', async () => {
    const token = await jwt.signAsync(payload, { secret: 'other' });
    await expect(
      guard.canActivate(makeContext(`Bearer ${token}`).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('401 on token signed with the refresh secret', async () => {
    const token = await jwt.signAsync(payload, { secret: SECRET + '_refresh' });
    await expect(
      guard.canActivate(makeContext(`Bearer ${token}`).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('401 on expired token', async () => {
    const token = await jwt.signAsync(payload, {
      secret: SECRET,
      expiresIn: -10,
    });
    await expect(
      guard.canActivate(makeContext(`Bearer ${token}`).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('passes with valid token and sets request.user', async () => {
    const token = await jwt.signAsync(payload, { secret: SECRET });
    const { ctx, request } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject(payload);
  });

  it('skips verification on @Public routes', async () => {
    class Ctl {
      @Public()
      open() {}
    }
    const { ctx } = makeContext(undefined, Ctl, Ctl.prototype.open);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('fails fast when JWT_SECRET is missing', () => {
    expect(
      () =>
        new JwtAuthGuard(jwt, new Reflector(), {
          get: () => undefined,
        } as never),
    ).toThrow('JWT_SECRET is required');
  });

  describe('AuthModule boot', () => {
    const original = process.env.JWT_SECRET;
    afterEach(() => {
      if (original === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = original;
    });

    const compile = () =>
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
          AuthModule,
        ],
      }).compile();

    it('fails to compile without JWT_SECRET', async () => {
      delete process.env.JWT_SECRET;
      await expect(compile()).rejects.toThrow('JWT_SECRET is required');
    });

    it('compiles with JWT_SECRET', async () => {
      process.env.JWT_SECRET = SECRET;
      const mod = await compile();
      expect(mod.get(JwtAuthGuard)).toBeDefined();
    });
  });
});
