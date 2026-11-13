import { Network } from "@meshsdk/core";

const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY || "";
const APP_NETWORK: Network = (process.env.APP_NETWORK?.toLowerCase() as Network) || "preview";
const APP_NETWORK_ID = APP_NETWORK === "mainnet" ? 1 : 0;

export { APP_NETWORK, APP_NETWORK_ID, BLOCKFROST_API_KEY };
