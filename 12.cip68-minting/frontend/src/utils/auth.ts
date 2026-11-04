"use server";

import { cookies } from "next/headers";
import { deserializeAddress, generateNonce } from "@meshsdk/core";
import { APP_NETWORK } from "@/constants/enviroments";
import { AUTH_NONCE_COOKIE_NAME } from "@/constants/common";
import { parseError } from "@/utils/error/parse-error";

export const getNonceAddress = async (address: string) => {
    try {
        if (!address?.trim()) {
            throw new Error("Wallet address is required.");
        }
        if (!deserializeAddress(address).pubKeyHash) {
            throw new Error("A payment-key wallet address is required.");
        }

        const nonce = generateNonce(`CIP-68 wallet login\nAddress: ${address}\nNetwork: ${APP_NETWORK}\n`);
        (await cookies()).set(AUTH_NONCE_COOKIE_NAME, nonce, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 5 * 60,
            path: "/api/auth",
        });

        return {
            data: nonce,
            result: true,
            message: "Nonce generated successfully",
        };
    } catch (e) {
        return {
            data: null,
            result: false,
            message: parseError(e),
        };
    }
};
