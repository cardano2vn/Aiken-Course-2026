import { deserializeDatum, pubKeyAddress, serializeAddressObj } from "@meshsdk/core";
import { APP_NETWORK_ID } from "@/constants/enviroments";
import type { Loan } from "@/types/loan";

export const convertDatum = ({
    plutusData,
}: {
    plutusData: string;
}): {
    borrower: Loan["borrower"];
    lender: Loan["lender"];
    principal: Loan["principal"];
    interestRate: Loan["interestRate"];
    collateralPolicyId: Loan["collateralPolicyId"];
    collateralAssetName: Loan["collateralAssetName"];
    collateralAmount: Loan["collateralAmount"];
    loanDuration: Loan["loanDuration"];
    dueDate: Loan["dueDate"];
    status: Loan["status"];
} => {
    try {
        const datum = deserializeDatum(plutusData);
        const fields = datum.fields;
        if (fields.length !== 9) throw new Error(`Expected 9 datum fields, received ${fields.length}`);

        const buildAddress = (paymentHex: string, stakeHex?: string): string => {
            if (typeof paymentHex !== "string" || paymentHex.length !== 56) {
                throw new Error(`Invalid payment hex length (expected 56): ${paymentHex}`);
            }
            if (stakeHex && stakeHex.length !== 56) {
                throw new Error(`Invalid stake hex length (expected 56): ${stakeHex}`);
            }
            return serializeAddressObj(pubKeyAddress(paymentHex, stakeHex || "", false), APP_NETWORK_ID);
        };
        const addressFromData = (addressData: (typeof fields)[number]): string => {
            const paymentHex = addressData.fields[0]?.fields[0]?.fields[0]?.bytes;
            const stakeHex = addressData.fields[1]?.fields[0]?.fields[0]?.fields[0]?.bytes;
            return buildAddress(paymentHex, stakeHex);
        };

        const borrower = addressFromData(fields[0]);
        const lender = fields[1].fields.length > 0 ? addressFromData(fields[1].fields[0]) : "";
        const dueDate = fields[8].fields.length > 0 ? Number(fields[8].fields[0].int) : undefined;
        if ((lender.length > 0) !== (dueDate !== undefined)) {
            throw new Error("Lender and due date must both be present for an active loan.");
        }
        const integerField = (index: number): number => {
            const value = Number(fields[index].int);
            if (!Number.isSafeInteger(value)) throw new Error(`Datum field ${index} is outside the supported integer range.`);
            return value;
        };

        return {
            borrower,
            lender,
            principal: integerField(2),
            interestRate: integerField(3),
            collateralPolicyId: fields[4].bytes,
            collateralAssetName: fields[5].bytes,
            collateralAmount: integerField(6),
            loanDuration: integerField(7),
            dueDate,
            status: lender ? "Active" : "Pending",
        };
    } catch (err) {
        throw new Error(`Invalid Plutus datum: ${err instanceof Error ? err.message : String(err)}`);
    }
};
