/* eslint-disable @typescript-eslint/no-explicit-any */
import { checkSignature, type DataSignature } from "@meshsdk/core";
import type { GetServerSidePropsContext, NextApiRequest, NextApiResponse } from "next";
import type { NextAuthOptions, User } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialProvider from "next-auth/providers/credentials";
import { AUTH_NONCE_COOKIE_NAME } from "@/constants/common";

interface Credentials {
    wallet: string;
    address: string;
    data: string;
    signature: DataSignature;
}

function isDataSignature(value: unknown): value is DataSignature {
    return (
        typeof value === "object" &&
        value !== null &&
        "key" in value &&
        typeof value.key === "string" &&
        "signature" in value &&
        typeof value.signature === "string"
    );
}

function isCredentials(value: unknown): value is Credentials {
    return (
        typeof value === "object" &&
        value !== null &&
        "wallet" in value &&
        typeof value.wallet === "string" &&
        "address" in value &&
        typeof value.address === "string" &&
        "data" in value &&
        typeof value.data === "string" &&
        "signature" in value &&
        isDataSignature(value.signature)
    );
}

function getNonceCookie(cookieHeader: string | undefined): string | null {
    const cookie = cookieHeader
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${AUTH_NONCE_COOKIE_NAME}=`));

    if (!cookie) {
        return null;
    }

    try {
        return decodeURIComponent(cookie.slice(AUTH_NONCE_COOKIE_NAME.length + 1));
    } catch {
        return null;
    }
}

/**
 * NextAuth configuration object
 *
 * - Uses `CredentialsProvider` for custom wallet-based authentication.
 * - Verifies a fresh, server-issued CIP-8 challenge against the wallet address.
 * - Stores user info in JWT and session objects.
 */
export const config: NextAuthOptions = {
    providers: [
        CredentialProvider({
            name: "credentials",
            credentials: {
                data: {},
            },
            async authorize(credentials, req) {
                if (typeof credentials?.data !== "string") {
                    return null;
                }

                let parsed: unknown;
                try {
                    parsed = JSON.parse(credentials.data);
                } catch {
                    return null;
                }

                if (!isCredentials(parsed) || !parsed.wallet.trim() || !parsed.address.trim()) {
                    return null;
                }

                const { wallet, address, data, signature } = parsed;
                const cookieHeader = req.headers?.cookie;
                const nonce = getNonceCookie(typeof cookieHeader === "string" ? cookieHeader : undefined);
                if (!nonce || nonce !== data) {
                    return null;
                }

                try {
                    if (!checkSignature(data, signature, address)) {
                        return null;
                    }
                } catch {
                    return null;
                }

                return {
                    id: address,
                    wallet,
                    address,
                };
            },
        }),
    ],

    callbacks: {
        /**
         * Redirect users after sign-in.
         */
        async redirect() {
            return "/dashboard";
        },

        /**
         * Custom JWT callback.
         * Attaches the `user` object to the token on first login.
         */
        async jwt({ user, token }: { user?: User; token: any }) {
            if (user) {
                token.user = user;
            }
            return token;
        },

        /**
         * Custom session callback.
         * Ensures `session.user` is always populated from token.
         */
        async session({ session, token }: { session: any; token: any }) {
            session.user = token.user;
            return session;
        },
    },
} satisfies NextAuthOptions;

/**
 * Helper function to get server-side session.
 * Works in both `getServerSideProps` and API routes.
 */
export function auth(...args: [GetServerSidePropsContext["req"], GetServerSidePropsContext["res"]] | [NextApiRequest, NextApiResponse] | []) {
    return getServerSession(...args, config);
}

/**
 * API route handlers for Next.js App Router (`GET` and `POST`).
 * These will expose NextAuth under `/api/auth/[...nextauth]`.
 */
