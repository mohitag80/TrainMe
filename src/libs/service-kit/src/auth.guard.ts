import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { bearerToken, hasAnyRole, type AuthUser, type Role, type TokenVerifier } from '@trainme/auth';
import { ProblemError } from '@trainme/errors';

const IS_PUBLIC = 'trainme:isPublic';
const REQUIRED_ROLES = 'trainme:roles';
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

/** Marks a route that needs no token (webhooks, public plan list, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires at least one of the given realm roles. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

type AuthedRequest = FastifyRequest & { user?: AuthUser };

/** Injects the verified caller into a controller method. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw ProblemError.unauthorized();
  return user;
});

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verify: TokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req.headers.authorization);
    if (!token) throw ProblemError.unauthorized();
    req.user = await this.verify(token);
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (roles?.length && !hasAnyRole(req.user, roles)) throw ProblemError.forbidden();
    return true;
  }
}
