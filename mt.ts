import { generateWallet, generateNewAccount } from "@stacks/wallet-sdk";
import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  listCV,
  tupleCV,
  uintCV,
  standardPrincipalCV,
  privateKeyToAddress,
} from "@stacks/transactions";
import { createNetwork } from "@stacks/network";
import dotenv from "dotenv";

dotenv.config();

// ============================================================================
// CONFIGURATION - Easily changeable values
// ============================================================================

// Fee in microSTX (0.0008 STX = 800 microSTX)
// If transactions fail with "NotEnoughFunds" or fee-related errors, increase this value
// Suggested values: 800 (low), 2000 (medium), 5000 (high), 10000 (very high)
const DEFAULT_FEE = 50000;

// Multi-transfer contract details
const CONTRACT_ADDRESS = "SP3P41M02B17XMNVNQMKRTDN22G92B3RG7JERWGDX";
const CONTRACT_NAME = "multi-transfer";
const FUNCTION_NAME = "multi-transfer";

// Maximum transfers per contract call (contract limit)
const MAX_TRANSFERS_PER_BATCH = 200;

// API Configuration
const STACKS_API_URL =
  process.env.STACKS_API_URL || "https://api.mainnet.hiro.so";

// ============================================================================
// Network Setup
// ============================================================================

const network = createNetwork({
  network: "mainnet",
  client: { baseUrl: STACKS_API_URL },
});

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchNonce(address: string): Promise<bigint> {
  const url = `${STACKS_API_URL}/v2/accounts/${address}`;
  const response = await fetch(url);
  if (response.status === 404) {
    return BigInt(0);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch nonce: ${response.statusText}`);
  }
  const data = (await response.json()) as any;
  return BigInt(data.nonce);
}

async function fetchBalance(address: string): Promise<number> {
  const balanceUrl = `${STACKS_API_URL}/extended/v1/address/${address}/balances`;
  const response = await fetch(balanceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch balance: ${response.statusText}`);
  }
  const data = (await response.json()) as any;
  return parseInt(data.stx.balance);
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

function formatSTX(microSTX: number): string {
  return (microSTX / 1_000_000).toFixed(6);
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error(
      "Usage: npx tsx multi_transfer.ts <funded_index> <start_index> <end_index> <amount_stx>",
    );
    console.error("");
    console.error("Arguments:");
    console.error("  funded_index  - Index of the funded wallet (sender)");
    console.error("  start_index   - Start index of recipient wallets");
    console.error(
      "  end_index     - End index of recipient wallets (inclusive)",
    );
    console.error("  amount_stx    - Amount of STX to send to each recipient");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx multi_transfer.ts 0 1 50 0.5");
    process.exit(1);
  }

  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error("Missing MNEMONIC in .env");
    process.exit(1);
  }

  const fundedIndex = parseInt(args[0], 10);
  const startIndex = parseInt(args[1], 10);
  const endIndex = parseInt(args[2], 10);
  const amountSTX = parseFloat(args[3]);
  const amountMicroSTX = Math.floor(amountSTX * 1_000_000);

  // Validate inputs
  if (
    isNaN(fundedIndex) ||
    isNaN(startIndex) ||
    isNaN(endIndex) ||
    isNaN(amountSTX)
  ) {
    console.error("Error: All numeric arguments must be valid numbers.");
    process.exit(1);
  }

  if (startIndex > endIndex) {
    console.error(
      "Error: start_index must be less than or equal to end_index.",
    );
    process.exit(1);
  }

  if (amountMicroSTX <= 0) {
    console.error("Error: amount_stx must be greater than 0.");
    process.exit(1);
  }

  const numRecipients = endIndex - startIndex + 1;
  const numBatches = Math.ceil(numRecipients / MAX_TRANSFERS_PER_BATCH);

  console.log("=".repeat(60));
  console.log("Multi-Transfer Script");
  console.log("=".repeat(60));
  console.log(`Contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`);
  console.log(`Network: ${STACKS_API_URL}`);
  console.log(
    `Fee per batch: ${formatSTX(DEFAULT_FEE)} STX (${DEFAULT_FEE} microSTX)`,
  );
  console.log("-".repeat(60));
  console.log(`Funded Wallet Index: ${fundedIndex}`);
  console.log(
    `Recipient Range: ${startIndex} to ${endIndex} (${numRecipients} recipients)`,
  );
  console.log(`Amount per recipient: ${amountSTX} STX`);
  console.log(
    `Number of batches: ${numBatches} (max ${MAX_TRANSFERS_PER_BATCH} per batch)`,
  );
  console.log("-".repeat(60));

  // 1. Derive Wallets
  console.log("Generating wallets from mnemonic...");
  let wallet = await generateWallet({
    secretKey: mnemonic,
    password: "",
  });

  // Ensure accounts exist up to the max index we need
  const maxIndex = Math.max(fundedIndex, endIndex);
  let currentCount = wallet.accounts.length;
  while (currentCount <= maxIndex) {
    const newWallet = await generateNewAccount(wallet);
    Object.assign(wallet, newWallet);
    currentCount = wallet.accounts.length;
  }

  const fundedAccount = wallet.accounts[fundedIndex];
  const fundedAddress = privateKeyToAddress(
    fundedAccount.stxPrivateKey,
    "mainnet",
  );
  const fundedKey = fundedAccount.stxPrivateKey;

  console.log(`Funded Wallet Address: ${fundedAddress}`);

  // 2. Check Balance
  console.log("Checking balance...");
  let availableMicroSTX: number;
  try {
    availableMicroSTX = await fetchBalance(fundedAddress);
    console.log(`Available Balance: ${formatSTX(availableMicroSTX)} STX`);
  } catch (error) {
    console.error("Failed to fetch balance. Is the Stacks API reachable?");
    console.error(error);
    process.exit(1);
  }

  // 3. Calculate total required
  const totalTransferAmount = amountMicroSTX * numRecipients;
  const totalFees = DEFAULT_FEE * numBatches;
  const totalRequired = totalTransferAmount + totalFees;

  console.log(`Total to transfer: ${formatSTX(totalTransferAmount)} STX`);
  console.log(`Total fees (estimated): ${formatSTX(totalFees)} STX`);
  console.log(`Total required: ${formatSTX(totalRequired)} STX`);

  if (availableMicroSTX < totalRequired) {
    console.error("-".repeat(60));
    console.error("ERROR: Insufficient funds!");
    console.error(`  Need: ${formatSTX(totalRequired)} STX`);
    console.error(`  Have: ${formatSTX(availableMicroSTX)} STX`);
    console.error(
      `  Short: ${formatSTX(totalRequired - availableMicroSTX)} STX`,
    );
    process.exit(1);
  }

  console.log("-".repeat(60));

  // 4. Build recipient list
  const recipients: { address: string; index: number }[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const account = wallet.accounts[i];
    const address = privateKeyToAddress(account.stxPrivateKey, "mainnet");
    recipients.push({ address, index: i });
  }

  // 5. Split into batches
  const batches = chunkArray(recipients, MAX_TRANSFERS_PER_BATCH);

  // 6. Execute batches
  let nonce = await fetchNonce(fundedAddress);
  console.log(`Starting nonce: ${nonce}`);
  console.log("=".repeat(60));

  let successfulBatches = 0;
  let failedBatches = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = batch[0].index;
    const batchEnd = batch[batch.length - 1].index;

    console.log(
      `\nBatch ${batchIndex + 1}/${batches.length}: Wallets ${batchStart}-${batchEnd} (${batch.length} recipients)`,
    );

    // Build the transfers list for the contract
    const transfersList = listCV(
      batch.map((recipient) =>
        tupleCV({
          recipient: standardPrincipalCV(recipient.address),
          amount: uintCV(amountMicroSTX),
        }),
      ),
    );

    const txOptions = {
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName: FUNCTION_NAME,
      functionArgs: [transfersList],
      senderKey: fundedKey,
      network: network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      nonce: nonce,
      fee: DEFAULT_FEE,
    };

    try {
      const transaction = await makeContractCall(txOptions);
      const broadcastResponse = await broadcastTransaction({
        transaction,
        network,
      });

      if ("error" in broadcastResponse) {
        console.error(`  FAILED: ${broadcastResponse.error}`);
        console.error(`  Reason: ${broadcastResponse.reason}`);

        // Verbose error messaging for fee-related issues
        const reason = String(broadcastResponse.reason || "").toLowerCase();
        const error = String(broadcastResponse.error || "").toLowerCase();

        if (
          reason.includes("notenoughfunds") ||
          reason.includes("fee") ||
          error.includes("fee") ||
          reason.includes("feerate")
        ) {
          console.error("");
          console.error("  *** FEE ERROR DETECTED ***");
          console.error("  The transaction fee may be too low.");
          console.error(
            `  Current fee: ${DEFAULT_FEE} microSTX (${formatSTX(DEFAULT_FEE)} STX)`,
          );
          console.error("  To fix this:");
          console.error("    1. Open multi_transfer.ts");
          console.error("    2. Find the line: const DEFAULT_FEE = 800;");
          console.error("    3. Increase the value (try 2000, 5000, or 10000)");
          console.error("    4. Save and re-run the script");
          console.error("");
        }

        // Handle bad nonce
        if (reason.includes("badnonce") || reason.includes("nonce")) {
          console.log("  Refreshing nonce...");
          nonce = await fetchNonce(fundedAddress);
        }

        failedBatches++;
      } else {
        console.log(`  SUCCESS: ${broadcastResponse.txid}`);
        console.log(
          `  Explorer: https://explorer.stacks.co/txid/${broadcastResponse.txid}?chain=mainnet`,
        );
        nonce = nonce + BigInt(1);
        successfulBatches++;
      }

      // Rate limiting protection
      if (batchIndex < batches.length - 1) {
        console.log("  Waiting before next batch...");
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e: any) {
      console.error(`  EXCEPTION: ${e.message || e}`);

      if (
        e?.message?.includes("429") ||
        e?.cause?.code === "UND_ERR_CONNECT_TIMEOUT"
      ) {
        console.log("  Rate limited. Waiting 10 seconds...");
        await new Promise((r) => setTimeout(r, 10000));
        // Retry this batch
        batchIndex--;
        continue;
      }

      failedBatches++;
    }
  }

  // 7. Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total batches: ${batches.length}`);
  console.log(`Successful: ${successfulBatches}`);
  console.log(`Failed: ${failedBatches}`);

  if (failedBatches > 0) {
    console.log("\nSome batches failed. Check the errors above.");
    process.exit(1);
  } else {
    console.log("\nAll transfers completed successfully!");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
