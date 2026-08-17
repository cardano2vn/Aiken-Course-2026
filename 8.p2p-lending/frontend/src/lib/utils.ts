import { deserializeDatum, pubKeyAddress, serializeAddressObj, hexToString } from "@meshsdk/core";
import { APP_NETWORK_ID } from "@/constants/enviroments";

export const convertDatum = ({
    plutusData,
}: {
    plutusData: string;
}): {
    borrower: string;
    lender: string;
    principal: number;
    interestRate: number;
    loanDuration: number;
    dueDate?: number;
    policyId: string;
    assetName: string;
    status: {
        type: "Active" | "Pending";
        fundedAt: number | undefined;
    };
} => {
    try {
        const datum = deserializeDatum(plutusData);

        const buildAddress = (paymentHex: string, stakeHex?: string): string => {
            if (typeof paymentHex !== "string" || paymentHex.length !== 56) {
                throw new Error(`Invalid payment hex length (expected 56): ${paymentHex}`);
            }
            if (stakeHex && stakeHex.length !== 56) {
                throw new Error(`Invalid stake hex length (expected 56): ${stakeHex}`);
            }
            return serializeAddressObj(pubKeyAddress(paymentHex, stakeHex || "", false), APP_NETWORK_ID);
        };
        const borrower = buildAddress(datum.fields[0].fields[0].fields[0].bytes, datum.fields[0].fields[1].fields[0].fields[0].fields[0].bytes);
        let lender = "";

        if (datum.fields[1] && datum.fields[1].fields && datum.fields[1].fields.length > 0) {
            try {
                const lenderFields = datum.fields[1].fields[0];
                if (lenderFields && lenderFields.fields && lenderFields.fields.length >= 2) {
                    const paymentHex = lenderFields.fields[0]?.fields?.[0]?.bytes;
                    const stakeHex = lenderFields.fields[1]?.fields?.[0]?.fields?.[0]?.fields?.[0]?.bytes;

                    if (paymentHex) {
                        lender = buildAddress(paymentHex, stakeHex || "");
                    }
                }
            } catch (e) {
                lender = "";
            }
        }

        return {
            borrower,
            lender,
            principal: Number(datum.fields[2].int),
            interestRate: Number(datum.fields[3].int),
            loanDuration: Number(datum.fields[4].int),
            dueDate: datum.fields[5].fields.length > 0 ? Number(datum.fields[5].fields[0].int) : 0,
            policyId: datum.fields[6].bytes,
            assetName: hexToString(datum.fields[7].bytes),
            status:
                datum.fields[8].fields.length > 0
                    ? {
                          type: "Active",
                          fundedAt: Number(datum.fields[8].fields[0].int),
                      }
                    : {
                          type: "Pending",
                          fundedAt: undefined,
                      },
        };
    } catch (err) {
        throw new Error(`Invalid Plutus datum: ${err instanceof Error ? err.message : String(err)}`);
    }
};
