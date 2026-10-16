import { deserializeDatum, pubKeyAddress, serializeAddressObj } from "@meshsdk/core";
import { APP_NETWORK_ID } from "@/constants/enviroments";

type PlutusDataNode = {
    bytes?: string;
    int?: bigint | number | string;
    fields?: PlutusDataNode[];
    map?: { k?: PlutusDataNode; v?: PlutusDataNode }[];
};

export const convertDatum = ({
    plutusData,
}: {
    plutusData: string;
}): {
    beneficiary: string;
    goal: number;
    deadline: number;
    contributions: { address: string; paymentKeyHash: string; quantity: number }[];
} => {
    try {
        const datum = deserializeDatum(plutusData) as PlutusDataNode;

        const buildAddress = (paymentHex: string, stakeHex?: string): string => {
            if (!paymentHex || paymentHex.length !== 56) {
                throw new Error(`Invalid payment credential: ${paymentHex}`);
            }
            if (stakeHex && stakeHex.length !== 56) {
                throw new Error(`Invalid stake credential: ${stakeHex}`);
            }
            return serializeAddressObj(pubKeyAddress(paymentHex, stakeHex ?? "", false), APP_NETWORK_ID);
        };

        const parseAddress = (addressDatum: PlutusDataNode | undefined): string => {
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
        const contributionsDatum = datum.fields?.[0];
        const beneficiaryDatum = datum.fields?.[1];
        const beneficiary = parseAddress(beneficiaryDatum);
        const goal = Number(datum.fields?.[2]?.int);
        const deadline = Number(datum.fields?.[3]?.int);
        if (!Number.isSafeInteger(goal) || goal <= 0 || !Number.isSafeInteger(deadline)) {
            throw new Error("Invalid campaign goal or deadline in datum");
        }
        const contributions: { address: string; paymentKeyHash: string; quantity: number }[] = [];
        const contributionMap = contributionsDatum?.map ?? [];

        for (const item of contributionMap) {
            const paymentKeyHash = item.k?.bytes;
            const quantity = Number(item.v?.int);

            if (!paymentKeyHash || paymentKeyHash.length !== 56 || !Number.isSafeInteger(quantity)) {
                throw new Error("Invalid contribution entry in campaign datum");
            }

            contributions.push({
                address: buildAddress(paymentKeyHash),
                paymentKeyHash,
                quantity,
            });
        }

        return { beneficiary, goal, deadline, contributions };
    } catch (err) {
        throw new Error(`Invalid Plutus datum: ${err instanceof Error ? err.message : String(err)}`);
    }
};
