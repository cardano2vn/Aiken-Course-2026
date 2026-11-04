import NextAuth from "next-auth";
import { config } from "@/lib/auth";
import { AUTH_NONCE_COOKIE_NAME } from "@/constants/common";

const handler = NextAuth(config);

export const GET = handler;

export async function POST(request: Request) {
    const response = await handler(request);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
        "Set-Cookie",
        `${AUTH_NONCE_COOKIE_NAME}=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
    );
    return response;
}
