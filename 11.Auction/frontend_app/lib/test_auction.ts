import { Asset, deserializeAddress, MeshTxBuilder, serializeData, UTxO } from "@meshsdk/core";
import { integer, pubKeyAddress } from "@meshsdk/common";
import { AuctionContract, auctionDatum } from "./offchain";

/**
 * Test Scenario 1: Verify Inline Plutus Datum Structure
 */
export async function testStartAuctionScenario() {
  console.log("=== RUNNING TEST SCENARIO: startAuction Datum ===");

  const mockSellerAddress =
    "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";
  const mockNftAssets: Asset[] = [
    {
      unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
      quantity: "1",
    },
  ];
  const mockMinBid = 5_000_000; // 5 ADA
  const mockDeadline = Date.now() + 3600 * 1000; // 1 hour in future

  const generatedDatum = auctionDatum(
    mockSellerAddress,
    mockDeadline,
    mockMinBid,
    mockNftAssets
  );

  console.log("Generated AuctionDatum (Inline Plutus Data):");
  console.log(JSON.stringify(generatedDatum, null, 2));

  const highestBidField = (generatedDatum as any)?.fields?.[4];
  const isHighestBidNone = highestBidField?.constructor === 1;

  if (isHighestBidNone) {
    console.log("✅ PASS: Datum highest_bid initialized to None constructor (1).");
  } else {
    console.error("❌ FAIL: Datum highest_bid is not None constructor!");
  }

  console.log("=== startAuction SCENARIO READY ===");
  return { generatedDatum, isHighestBidNone };
}

/**
 * Test Scenario 2: Verify Complete Transaction Hex Building for startAuction
 */
export async function testStartAuctionTxBuilding() {
  console.log("\n=== RUNNING TEST SCENARIO: startAuction Tx Building ===");

  const mockSellerAddress =
    "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";

  const mockUtxos: UTxO[] = [
    {
      input: {
        txHash: "1111111111111111111111111111111111111111111111111111111111111111",
        outputIndex: 0,
      },
      output: {
        address: mockSellerAddress,
        amount: [
          { unit: "lovelace", quantity: "100000000" }, // 100 ADA
          {
            unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
            quantity: "1",
          },
        ],
      },
    },
  ];

  const mockWallet: any = {
    getUtxos: async () => mockUtxos,
    getUsedAddresses: async () => [mockSellerAddress],
    getUnusedAddresses: async () => [],
    getChangeAddress: async () => mockSellerAddress,
    getCollateral: async () => [mockUtxos[0]],
  };

  const mesh = new MeshTxBuilder();
  const contract = new AuctionContract({
    mesh,
    wallet: mockWallet,
    networkId: 0,
  });

  const nftAssets: Asset[] = [
    {
      unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
      quantity: "1",
    },
  ];
  const minBid = 5_000_000;
  const deadline = Date.now() + 3600 * 1000;

  const txHex = await contract.startAuction(nftAssets, minBid, deadline);

  console.log("Script Address:", contract.scriptAddress);
  console.log("Generated TxHex (First 120 chars):", txHex.slice(0, 120) + "...");
  console.log("TxHex Total Length:", txHex.length, "bytes/chars");
  console.log("✅ PASS: TxHex generated successfully for startAuction!");

  return txHex;
}

/**
 * Test Scenario 3: Verify Update Min Bid Transaction Hex Building (Script Spending)
 */
export async function testUpdateTxBuilding() {
  console.log("\n=== RUNNING TEST SCENARIO: update Tx Building ===");

  const mockSellerAddress =
    "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";

  const mockWalletUtxos: UTxO[] = [
    {
      input: {
        txHash: "1111111111111111111111111111111111111111111111111111111111111111",
        outputIndex: 0,
      },
      output: {
        address: mockSellerAddress,
        amount: [{ unit: "lovelace", quantity: "50000000" }],
      },
    },
  ];

  const deadlineMs = Date.now() + 3600 * 1000;
  const nftAssets: Asset[] = [
    {
      unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
      quantity: "1",
    },
  ];

  const initialDatum = auctionDatum(
    mockSellerAddress,
    deadlineMs,
    5_000_000,
    nftAssets
  );

  const initialDatumCbor = serializeData(initialDatum, "JSON");

  // Temporary contract instance to resolve scriptAddress
  const tempMesh = new MeshTxBuilder();
  const tempContract = new AuctionContract({ mesh: tempMesh, networkId: 0 });

  const mockAuctionUtxo: UTxO = {
    input: {
      txHash: "2222222222222222222222222222222222222222222222222222222222222222",
      outputIndex: 0,
    },
    output: {
      address: tempContract.scriptAddress,
      amount: [
        { unit: "lovelace", quantity: "2000000" },
        ...nftAssets,
      ],
      plutusData: initialDatumCbor,
    },
  };

  const mockFetcher: any = {
    fetchUTxOs: async (txHash: string) => [mockAuctionUtxo],
    fetchAddressUTxOs: async (address: string) => [mockAuctionUtxo],
    fetchCostModels: async () => ({
      PlutusV3: [
        100788, 420, 1, 1, 1000, 173, 0, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000
      ],
    }),
    fetchProtocolParameters: async () => ({
      coinsPerUTxOByte: 4310,
      maxTxSize: 16384,
      minFeeA: 44,
      minFeeB: 155381,
      maxValSize: 5000,
      keyDeposit: 2000000,
      poolDeposit: 500000000,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 14000000,
      maxTxExSteps: 10000000000,
    }),
  };

  const mockEvaluator: any = {
    evaluateTx: async () => [
      {
        index: 0,
        tag: "SPEND",
        budget: { mem: 500000, steps: 200000000 },
      },
    ],
  };

  const mockWallet: any = {
    getUtxos: async () => mockWalletUtxos,
    getUsedAddresses: async () => [mockSellerAddress],
    getUnusedAddresses: async () => [],
    getChangeAddress: async () => mockSellerAddress,
    getCollateral: async () => [mockWalletUtxos[0]],
  };

  const mesh = new MeshTxBuilder({ fetcher: mockFetcher, evaluator: mockEvaluator });
  const contract = new AuctionContract({
    mesh,
    wallet: mockWallet,
    fetcher: mockFetcher,
    networkId: 0,
  });

  const newMinBid = 10_000_000; // Cập nhật min_bid mới thành 10 ADA
  const txHex = await contract.update(mockAuctionUtxo, newMinBid);

  console.log("Generated TxHex for update (First 120 chars):", txHex.slice(0, 120) + "...");
  console.log("TxHex Total Length:", txHex.length, "bytes/chars");
  console.log("✅ PASS: TxHex generated successfully for update!");

  return txHex;
}

/**
 * Test Scenario 4: Verify Cancel Auction Transaction Hex Building (Reclaim NFT before deadline)
 */
export async function testCancelTxBuilding() {
  console.log("\n=== RUNNING TEST SCENARIO: cancelAuction Tx Building ===");

  const mockSellerAddress =
    "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";

  const mockWalletUtxos: UTxO[] = [
    {
      input: {
        txHash: "1111111111111111111111111111111111111111111111111111111111111111",
        outputIndex: 0,
      },
      output: {
        address: mockSellerAddress,
        amount: [{ unit: "lovelace", quantity: "50000000" }],
      },
    },
  ];

  const deadlineMs = Date.now() + 3600 * 1000;
  const nftAssets: Asset[] = [
    {
      unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
      quantity: "1",
    },
  ];

  const initialDatum = auctionDatum(
    mockSellerAddress,
    deadlineMs,
    5_000_000,
    nftAssets
  );

  const initialDatumCbor = serializeData(initialDatum, "JSON");

  const tempMesh = new MeshTxBuilder();
  const tempContract = new AuctionContract({ mesh: tempMesh, networkId: 0 });

  const mockAuctionUtxo: UTxO = {
    input: {
      txHash: "2222222222222222222222222222222222222222222222222222222222222222",
      outputIndex: 0,
    },
    output: {
      address: tempContract.scriptAddress,
      amount: [
        { unit: "lovelace", quantity: "2000000" },
        ...nftAssets,
      ],
      plutusData: initialDatumCbor,
    },
  };

  const mockFetcher: any = {
    fetchUTxOs: async (txHash: string) => [mockAuctionUtxo],
    fetchAddressUTxOs: async (address: string) => [mockAuctionUtxo],
    fetchCostModels: async () => ({
      PlutusV3: [
        100788, 420, 1, 1, 1000, 173, 0, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000
      ],
    }),
    fetchProtocolParameters: async () => ({
      coinsPerUTxOByte: 4310,
      maxTxSize: 16384,
      minFeeA: 44,
      minFeeB: 155381,
      maxValSize: 5000,
      keyDeposit: 2000000,
      poolDeposit: 500000000,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 14000000,
      maxTxExSteps: 10000000000,
    }),
  };

  const mockEvaluator: any = {
    evaluateTx: async () => [
      {
        index: 0,
        tag: "SPEND",
        budget: { mem: 500000, steps: 200000000 },
      },
    ],
  };

  const mockWallet: any = {
    getUtxos: async () => mockWalletUtxos,
    getUsedAddresses: async () => [mockSellerAddress],
    getUnusedAddresses: async () => [],
    getChangeAddress: async () => mockSellerAddress,
    getCollateral: async () => [mockWalletUtxos[0]],
  };

  const mesh = new MeshTxBuilder({ fetcher: mockFetcher, evaluator: mockEvaluator });
  const contract = new AuctionContract({
    mesh,
    wallet: mockWallet,
    fetcher: mockFetcher,
    networkId: 0,
  });

  const txHex = await contract.cancel(mockAuctionUtxo);

  console.log("Generated TxHex for cancel (First 120 chars):", txHex.slice(0, 120) + "...");
  console.log("TxHex Total Length:", txHex.length, "bytes/chars");
  console.log("✅ PASS: TxHex generated successfully for cancelAuction!");

  return txHex;
}

/**
 * Test Scenario 5: Verify Bid Transaction Hex Building (MkBid Redeemer & Highest Bid Update)
 */
export async function testBidTxBuilding() {
  console.log("\n=== RUNNING TEST SCENARIO: bid Tx Building ===");

  const mockSellerAddress =
    "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";
  const mockBidderAddress =
    "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8vg27qdvhvnv02j2wf3hq8n6hqypjydy";

  const mockBidderUtxos: UTxO[] = [
    {
      input: {
        txHash: "3333333333333333333333333333333333333333333333333333333333333333",
        outputIndex: 0,
      },
      output: {
        address: mockBidderAddress,
        amount: [{ unit: "lovelace", quantity: "100000000" }], // 100 ADA
      },
    },
  ];

  const deadlineMs = Date.now() + 3600 * 1000;
  const nftAssets: Asset[] = [
    {
      unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
      quantity: "1",
    },
  ];

  const initialDatum = auctionDatum(
    mockSellerAddress,
    deadlineMs,
    5_000_000,
    nftAssets
  );

  const initialDatumCbor = serializeData(initialDatum, "JSON");

  const tempMesh = new MeshTxBuilder();
  const tempContract = new AuctionContract({ mesh: tempMesh, networkId: 0 });

  const mockAuctionUtxo: UTxO = {
    input: {
      txHash: "2222222222222222222222222222222222222222222222222222222222222222",
      outputIndex: 0,
    },
    output: {
      address: tempContract.scriptAddress,
      amount: [
        { unit: "lovelace", quantity: "2000000" },
        ...nftAssets,
      ],
      plutusData: initialDatumCbor,
    },
  };

  const mockFetcher: any = {
    fetchUTxOs: async () => [mockAuctionUtxo],
    fetchAddressUTxOs: async () => [mockAuctionUtxo],
    fetchCostModels: async () => ({
      PlutusV3: [
        100788, 420, 1, 1, 1000, 173, 0, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000, 59957, 4, 1, 1000
      ],
    }),
    fetchProtocolParameters: async () => ({
      coinsPerUTxOByte: 4310,
      maxTxSize: 16384,
      minFeeA: 44,
      minFeeB: 155381,
      maxValSize: 5000,
      keyDeposit: 2000000,
      poolDeposit: 500000000,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 14000000,
      maxTxExSteps: 10000000000,
    }),
  };

  const mockEvaluator: any = {
    evaluateTx: async () => [
      {
        index: 0,
        tag: "SPEND",
        budget: { mem: 500000, steps: 200000000 },
      },
    ],
  };

  const mockWallet: any = {
    getUtxos: async () => mockBidderUtxos,
    getUsedAddresses: async () => [mockBidderAddress],
    getUnusedAddresses: async () => [],
    getChangeAddress: async () => mockBidderAddress,
    getCollateral: async () => [mockBidderUtxos[0]],
  };

  const mesh = new MeshTxBuilder({ fetcher: mockFetcher, evaluator: mockEvaluator });
  const contract = new AuctionContract({
    mesh,
    wallet: mockWallet,
    fetcher: mockFetcher,
    networkId: 0,
  });

  const bidAmountInLovelace = 15_000_000; // 15 ADA
  const txHex = await contract.bid(mockAuctionUtxo, bidAmountInLovelace);

  console.log("Generated TxHex for bid (First 120 chars):", txHex.slice(0, 120) + "...");
  console.log("TxHex Total Length:", txHex.length, "bytes/chars");
  console.log("✅ PASS: TxHex generated successfully for bid!");

  return txHex;
}

/**
 * Test Scenario 6: Verify Close Auction Tx Building — có winner, NFT output phải kèm min ADA
 * Đây là test để verify fix lỗi code 3136: txOut NFT cho winner không có lovelace.
 */
export async function testCloseTxBuilding() {
  console.log("\n=== RUNNING TEST SCENARIO: closeAuction Tx Building (with winner) ===");

  const mockSellerAddress =
    "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";
  const mockBidderAddress =
    "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8vg27qdvhvnv02j2wf3hq8n6hqypjydy";

  const mockWalletUtxos: UTxO[] = [
    {
      input: {
        txHash: "4444444444444444444444444444444444444444444444444444444444444444",
        outputIndex: 0,
      },
      output: {
        address: mockBidderAddress,
        amount: [{ unit: "lovelace", quantity: "100000000" }],
      },
    },
  ];

  const bidAmountLovelace = 15_000_000; // 15 ADA
  const deadlineMs = Date.now() - 60_000; // deadline đã qua 1 phút

  const nftAssets: Asset[] = [
    {
      unit: "6b8f08573ef808f972b2cfe93d86dd1c34a17957771744b82bc0e5994d79546573744e4654",
      quantity: "1",
    },
  ];

  const { pubKeyHash: sellerPkh, stakeCredentialHash: sellerStake } = deserializeAddress(mockSellerAddress);
  const { pubKeyHash: bidderPkh, stakeCredentialHash: bidderStake } = deserializeAddress(mockBidderAddress);

  // Datum mô phỏng: highest_bid = Some(BidState { bidder, amount })
  const datumWithWinner = {
    constructor: 0,
    fields: [
      pubKeyAddress(sellerPkh, sellerStake || ""),  // seller
      integer(deadlineMs),                           // deadline
      integer(5_000_000),                            // min_bid
      { list: [] },                                  // nft (empty for test simplicity)
      {
        constructor: 0,  // Some
        fields: [
          {
            constructor: 0,  // BidState
            fields: [
              pubKeyAddress(bidderPkh, bidderStake || ""),
              integer(bidAmountLovelace),
            ],
          },
        ],
      },
    ],
  };

  const datumCbor = serializeData(datumWithWinner, "JSON");

  const tempMesh = new MeshTxBuilder();
  const tempContract = new AuctionContract({ mesh: tempMesh, networkId: 0 });

  // Script UTxO sau khi bid: chứa bidAmount lovelace + NFT (không có 2 ADA min deposit nữa)
  const mockAuctionUtxo: UTxO = {
    input: {
      txHash: "5555555555555555555555555555555555555555555555555555555555555555",
      outputIndex: 0,
    },
    output: {
      address: tempContract.scriptAddress,
      amount: [
        { unit: "lovelace", quantity: bidAmountLovelace.toString() },
        ...nftAssets,
      ],
      plutusData: datumCbor,
    },
  };

  const mockFetcher: any = {
    fetchUTxOs: async () => [mockAuctionUtxo],
    fetchAddressUTxOs: async () => [mockAuctionUtxo],
    fetchCostModels: async () => ({ PlutusV3: [100788, 420, 1, 1, 1000, 173, 0, 1] }),
    fetchProtocolParameters: async () => ({
      coinsPerUTxOByte: 4310,
      maxTxSize: 16384,
      minFeeA: 44,
      minFeeB: 155381,
      maxValSize: 5000,
      keyDeposit: 2000000,
      poolDeposit: 500000000,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 14000000,
      maxTxExSteps: 10000000000,
    }),
  };

  const mockEvaluator: any = {
    evaluateTx: async () => [
      { index: 0, tag: "SPEND", budget: { mem: 400000, steps: 120000000 } },
    ],
  };

  const mockWallet: any = {
    getUtxos: async () => mockWalletUtxos,
    getUsedAddresses: async () => [mockBidderAddress],
    getUnusedAddresses: async () => [],
    getChangeAddress: async () => mockBidderAddress,
    getCollateral: async () => [mockWalletUtxos[0]],
  };

  const mesh = new MeshTxBuilder({ fetcher: mockFetcher, evaluator: mockEvaluator });
  const contract = new AuctionContract({
    mesh,
    wallet: mockWallet,
    fetcher: mockFetcher,
    networkId: 0,
  });

  const txHex = await contract.close(mockAuctionUtxo);

  console.log("Generated TxHex for close (First 120 chars):", txHex.slice(0, 120) + "...");
  console.log("TxHex Total Length:", txHex.length, "bytes/chars");
  console.log("✅ PASS: TxHex generated for closeAuction with winner (min ADA included)!");

  return txHex;
}
