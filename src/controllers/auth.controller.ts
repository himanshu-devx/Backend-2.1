import { Context } from "hono";
import { ok, err } from "@/utils/result";
import { respond } from "@/utils/result-http";
import { Unauthorized } from "@/utils/error";
import jwt from "jsonwebtoken";
import { ENV } from "@/config/env";
import { generateAuthToken } from "@/utils/jwt";
import { merchantRepository } from "@/repositories/merchant.repository";
import { adminRepository } from "@/repositories/admin.repository";
import { getRoleCategory, ROLE_CATEGORY } from "@/constants/users.constant";

export class AuthController {
  static async refresh(c: Context) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return respond(c, err(Unauthorized("Missing or invalid Authorization header.")));
    }
    const token = authHeader.substring(7).trim();

    try {
      // Decode to identify user first
       const decoded = jwt.decode(token) as any;
       if (!decoded || !decoded.id) {
         return respond(c, err(Unauthorized("Invalid token payload.")));
       }

       // We verify the signature. 
       // NOTE: If we want to allow refreshing EXPIRED tokens, we would catch TokenExpiredError here 
       // and ignore it IF it's within a grace period. 
       // For now, we enforce validity (Sliding Window before expiry).
       jwt.verify(token, ENV.JWT_SECRET);

       const category = getRoleCategory(decoded.role);
       let user;

       if (category === ROLE_CATEGORY.MERCHANT) {
         user = await merchantRepository.findOne({ id: decoded.id });
       } else {
         // Admin or Support
         user = await adminRepository.findOne({ id: decoded.id });
       }

       if (!user || !user.status) {
         return respond(c, err(Unauthorized("Account inactive or not found.")));
       }

       // Issue new token
       const newToken = generateAuthToken({
         id: user.id,
         email: user.email,
         role: user.role
       });

       return respond(c, ok({ token: newToken }));

    } catch (e: any) {
        return respond(c, err(Unauthorized("Token verification failed.", { cause: e })));
    }
  }
}
