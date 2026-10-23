export interface Loan {
    borrower: string;
    lender: string;
    principal: number;
    interestRate: number;
    collateralPolicyId: string;
    collateralAssetName: string;
    collateralAmount: number;
    loanDuration: number;
    dueDate?: number;
    status: "Active" | "Pending";
    txHash: string;
    outputIndex: number;
}

export interface LoanReference {
    txHash: string;
    outputIndex: number;
}
