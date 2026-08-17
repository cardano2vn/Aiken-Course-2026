import { deserializeDatum, pubKeyAddress, serializeAddressObj } from "@meshsdk/core";
import { APP_NETWORK_ID } from "@/constants/enviroments";

export const convertDatum = ({
    plutusData,
}: {
    plutusData: string;
}): {
    beneficiary: string;
    goal: number;
    deadline: number;
    contributions: { address: string; quantity: number }[];
} => {
    try {
        const datum = deserializeDatum(plutusData);

        const buildAddress = (paymentHex: string, stakeHex?: string): string => {
            if (!paymentHex || paymentHex.length !== 56) {
                throw new Error(`Invalid payment credential: ${paymentHex}`);
            }
            if (stakeHex && stakeHex.length !== 56) {
                throw new Error(`Invalid stake credential: ${stakeHex}`);
            }
            return serializeAddressObj(pubKeyAddress(paymentHex, stakeHex ?? "", false), APP_NETWORK_ID);
        };

        const parseAddress = (addressDatum: any): string => {
            if (!addressDatum?.fields) {
                throw new Error("Invalid address datum");
            }
            const paymentHex = addressDatum?.fields?.[0]?.fields?.[0]?.bytes;
            const stakeHex = addressDatum?.fields?.[1]?.fields?.[0]?.fields?.[0]?.fields?.[0]?.bytes;
            if (!paymentHex) {
                throw new Error("Missing payment credential");
            }
            return buildAddress(paymentHex, stakeHex);
        };
        const beneficiaryDatum = datum.fields?.[0];
        const beneficiary = parseAddress(beneficiaryDatum);
        const goal = Number(datum.fields?.[1]?.int);
        const deadline = Number(datum.fields?.[2]?.int);
        const contributions: { address: string; quantity: number }[] = [];
        const contributionMap = datum.fields?.[3]?.map ?? [];

        for (const item of contributionMap) {
            const addressDatum = item.k;
            const quantity = Number(item.v?.int);

            try {
                const address = parseAddress(addressDatum);
                contributions.push({ address, quantity });
            } catch (err) {
                console.warn("Skipping invalid contribution:", err);
            }
        }

        return { beneficiary, goal, deadline, contributions };
    } catch (err) {
        try {
            console.dir(deserializeDatum(plutusData), { depth: null });
        } catch {}

        throw new Error(`Invalid Plutus datum: ${err instanceof Error ? err.message : String(err)}`);
    }
};
