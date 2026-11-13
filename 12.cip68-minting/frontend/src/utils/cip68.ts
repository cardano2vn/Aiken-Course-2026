import { deserializeAddress } from "@meshsdk/core";

export function assetNameByteLength(assetName: string): number {
    return new TextEncoder().encode(assetName).length;
}

export function paymentKeyHashOf(address: string | null): string | null {
    if (!address) {
        return null;
    }

    try {
        return deserializeAddress(address).pubKeyHash || null;
    } catch {
        return null;
    }
}

export function isAssetAuthor(authorHash: unknown, address: string | null): boolean {
    if (typeof authorHash !== "string") {
        return false;
    }

    const paymentKeyHash = paymentKeyHashOf(address);
    return paymentKeyHash !== null && paymentKeyHash.toLowerCase() === authorHash.toLowerCase();
}
