import type { IFetcher, UTxO } from "@meshsdk/core";
import { serializeAddressObj, deserializeDatum } from "@meshsdk/core";
import type { OracleDatum } from "./types";
import { NETWORK_ID } from "./config";

export interface OracleData {
  nextNftIndex: number;
  minPrice: number;
  oracleUtxo: UTxO;
  oracleNftPolicyId: string;
  adminAddress: string;
}

/**
 * Truy vấn Oracle UTxO và parse datum.
 */
export const getOracleData = async (
  provider: IFetcher,
  oracleAddress: string,
  oracleNftPolicyId: string
): Promise<OracleData> => {
  // Tìm UTxO chứa Oracle Token
  const utxos = await provider.fetchAddressUTxOs(oracleAddress);
  const oracleUtxo = utxos.find((u) =>
    u.output.amount.some((a) => a.unit.startsWith(oracleNftPolicyId))
  );

  if (!oracleUtxo) {
    throw new Error("Oracle UTxO not found — oracle may not be initialized");
  }

  // Parse inline datum
  const rawDatum = oracleUtxo.output.plutusData;
  if (!rawDatum) {
    throw new Error(
      "Oracle UTxO missing plutusData — possible spam UTxO or datum was not attached during setup"
    );
  }
  const oracleDatum: OracleDatum = deserializeDatum(rawDatum);

  const nextNftIndex = Number(oracleDatum.fields[0].int);
  const minPrice = Number(oracleDatum.fields[1].int);
  const adminAddress = serializeAddressObj(oracleDatum.fields[2], NETWORK_ID);

  return {
    nextNftIndex,
    minPrice,
    oracleUtxo,
    oracleNftPolicyId,
    adminAddress,
  };
};
