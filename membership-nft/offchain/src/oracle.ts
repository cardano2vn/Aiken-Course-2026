import type { IFetcher, UTxO } from "@meshsdk/core";
import { serializeAddressObj } from "@meshsdk/core";
import { parseDatumCbor } from "@meshsdk/core-cst";
import type { OracleDatum } from "./types";
import { NETWORK_ID } from "./config";

export interface OracleData {
  nftIndex: number;
  minPrice: number;
  oracleUtxo: UTxO;
  oracleNftPolicyId: string;
  adminAddress: string;
  adminAddressObj: OracleDatum["fields"][2];
}

/**
 * Truy vấn Oracle UTxO và parse datum.
 */
export const getOracleData = async (
  provider: IFetcher,
  oracleAddress: string,
  oracleNftPolicyId: string,
  networkId: number = NETWORK_ID
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
  const oracleDatum: OracleDatum = parseDatumCbor(
    oracleUtxo.output.plutusData!
  );

  const nftIndex = Number(oracleDatum.fields[0].int);
  const minPrice = Number(oracleDatum.fields[1].int);
  const adminAddressObj = oracleDatum.fields[2];
  const adminAddress = serializeAddressObj(adminAddressObj, networkId);

  return {
    nftIndex,
    minPrice,
    oracleUtxo,
    oracleNftPolicyId,
    adminAddress,
    adminAddressObj,
  };
};
