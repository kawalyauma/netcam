import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AdminRole } from "@netcam/shared";

export interface JwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  role: AdminRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? "insecure-dev-secret",
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedAdmin> {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
