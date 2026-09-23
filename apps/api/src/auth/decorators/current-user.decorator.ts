import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedAdmin } from "../jwt.strategy";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
  const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedAdmin }>();
  return request.user;
});
