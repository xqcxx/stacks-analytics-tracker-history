import { generateWallet, generateNewAccount } from "@stacks/wallet-sdk";
import {
  makeContractCall,
  stringAsciiCV,
  stringUtf8CV,
  uintCV,
  privateKeyToAddress,
} from "@stacks/transactions";
import type { ClarityValue } from "@stacks/transactions";
import { createNetwork } from "@stacks/network";
import dotenv from "dotenv";

dotenv.config();

const STACKS_API_URL =
  process.env.STACKS_API_URL || "https://api.mainnet.hiro.so";
const DEPLOYER_ADDRESS =
  process.env.DEPLOYER_ADDRESS || "SP3CPTJFP3TQK00DV0B5SGE8R0N3Z40MWJ6QZD38Y";
const TX_FEE_MICROSTX = Number(process.env.TX_FEE_MICROSTX || 800);
const HIRO_API_KEY =
  process.env.HIRO_API_KEY?.trim() || "056f204e0e3f3ca7cb60e57c123c8e24";
const HAS_HIRO_API_KEY = Boolean(HIRO_API_KEY);
const HIRO_RPM_LIMIT = Math.max(
  1,
  Number(process.env.HIRO_RPM_LIMIT || (HAS_HIRO_API_KEY ? 900 : 50)),
);
const HIRO_TARGET_UTILIZATION = Math.min(
  1,
  Math.max(0.1, Number(process.env.HIRO_TARGET_UTILIZATION || 0.8)),
);
const EFFECTIVE_RPM_BUDGET = Math.max(
  1,
  Math.floor(HIRO_RPM_LIMIT * HIRO_TARGET_UTILIZATION),
);
const MIN_DELAY_PER_REQUEST_MS = Math.ceil(60000 / EFFECTIVE_RPM_BUDGET);

const NONCE_BATCH_DELAY_MS = Math.max(
  0,
  Number(process.env.NONCE_BATCH_DELAY_MS || MIN_DELAY_PER_REQUEST_MS),
);
const BROADCAST_BATCH_DELAY_MS = Math.max(
  0,
  Number(process.env.BROADCAST_BATCH_DELAY_MS || MIN_DELAY_PER_REQUEST_MS),
);

const derivedNonceBatchSize = Math.max(
  1,
  Math.floor((EFFECTIVE_RPM_BUDGET * NONCE_BATCH_DELAY_MS) / 60000),
);
const derivedBroadcastBatchSize = Math.max(
  1,
  Math.floor((EFFECTIVE_RPM_BUDGET * BROADCAST_BATCH_DELAY_MS) / 60000),
);

const NONCE_BATCH_SIZE = Math.max(
  1,
  Number(process.env.NONCE_BATCH_SIZE || derivedNonceBatchSize),
);
const BROADCAST_BATCH_SIZE = Math.max(
  1,
  Number(process.env.BROADCAST_BATCH_SIZE || derivedBroadcastBatchSize),
);
const BROADCAST_RETRIES = Math.max(
  0,
  Number(process.env.BROADCAST_RETRIES || 3),
);
const BROADCAST_RETRY_BASE_DELAY_MS = Math.max(
  100,
  Number(process.env.BROADCAST_RETRY_BASE_DELAY_MS || 1000),
);

const network = createNetwork({
  network: "mainnet",
  client: { baseUrl: STACKS_API_URL },
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runInBatches<T, U>(
  items: T[],
  batchSize: number,
  batchDelayMs: number,
  label: string,
  handler: (item: T) => Promise<U>,
): Promise<Array<PromiseSettledResult<U>>> {
  const settled: Array<PromiseSettledResult<U>> = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batchNumber = Math.floor(offset / batchSize) + 1;
    const batch = items.slice(offset, offset + batchSize);
    console.log(
      `${label}: batch ${batchNumber}/${totalBatches} (size ${batch.length})`,
    );

    const results = await Promise.allSettled(
      batch.map((item) => handler(item)),
    );
    settled.push(...results);

    if (batchNumber < totalBatches && batchDelayMs > 0) {
      await delay(batchDelayMs);
    }
  }

  return settled;
}

async function fetchNonce(address: string): Promise<bigint> {
  const url = `${STACKS_API_URL}/extended/v1/address/${address}/nonces`;
  const response = await fetch(url, {
    headers: HAS_HIRO_API_KEY
      ? {
          "x-api-key": HIRO_API_KEY,
        }
      : undefined,
  });
  if (response.status === 404) {
    return BigInt(0);
  }
  if (!response.ok) {
    const body = ((await response.text()) || "<none>").slice(0, 300);
    throw new Error(
      `Failed to fetch nonce for ${address}: ${response.status} ${response.statusText} ${body}`,
    );
  }

  const data = (await response.json()) as {
    nonce?: string | number;
    possible_next_nonce?: string | number;
  };
  if (data.possible_next_nonce !== undefined) {
    return BigInt(data.possible_next_nonce);
  }
  if (data.nonce !== undefined) {
    return BigInt(data.nonce);
  }

  throw new Error(`Unexpected nonce response for ${address}`);
}

type BroadcastResponse =
  | {
      txid: string;
    }
  | {
      error: string;
      reason: string;
    };

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) {
    return null;
  }
  return Math.floor(sec * 1000);
}

async function broadcastWithRetry(
  transaction: Awaited<ReturnType<typeof makeContractCall>>,
): Promise<BroadcastResponse> {
  const url = `${STACKS_API_URL}/v2/transactions`;
  let attempt = 0;
  let nextDelayMs = BROADCAST_RETRY_BASE_DELAY_MS;

  const serialized = transaction.serialize() as string | Uint8Array;
  const transactionBody =
    typeof serialized === "string"
      ? Buffer.from(serialized.replace(/^0x/i, ""), "hex")
      : Buffer.from(serialized);

  while (attempt <= BROADCAST_RETRIES) {
    attempt += 1;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(HAS_HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {}),
        },
        body: transactionBody,
      });

      const bodyText = await response.text();

      if (response.ok) {
        let txid = bodyText.trim();
        try {
          const parsed = JSON.parse(bodyText) as {
            txid?: string;
            tx_id?: string;
          };
          txid = parsed.txid || parsed.tx_id || txid;
        } catch {
          // keep raw text
        }
        txid = txid.replace(/^"|"$/g, "");
        return { txid };
      }

      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );

      let reason = `${response.status} ${response.statusText} ${bodyText}`
        .trim()
        .slice(0, 500);
      try {
        const parsed = JSON.parse(bodyText) as {
          error?: string;
          reason?: string;
          message?: string;
        };
        reason = String(parsed.reason || parsed.message || reason).slice(
          0,
          500,
        );
      } catch {
        // keep derived reason
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt <= BROADCAST_RETRIES) {
        await delay(retryAfterMs ?? nextDelayMs);
        nextDelayMs *= 2;
        continue;
      }

      return {
        error: "transaction rejected",
        reason,
      };
    } catch (e: any) {
      const message = e?.message || String(e);
      if (attempt <= BROADCAST_RETRIES) {
        await delay(nextDelayMs);
        nextDelayMs *= 2;
        continue;
      }

      return {
        error: "broadcast exception",
        reason: message,
      };
    }
  }

  return {
    error: "broadcast exception",
    reason: "Retries exhausted",
  };
}

function randomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789    ";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result.trim();
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Realistic analytics data generators
// ---------------------------------------------------------------------------

const PAGE_PATHS = [
  "/home", "/about", "/pricing", "/dashboard", "/settings",
  "/profile", "/docs", "/api", "/blog", "/contact",
  "/signup", "/login", "/features", "/changelog", "/support",
  "/marketplace", "/explore", "/analytics", "/billing", "/team",
];

const ACTION_NAMES = [
  "click-cta", "scroll-bottom", "open-modal", "close-modal",
  "toggle-theme", "expand-menu", "submit-form", "copy-link",
  "share-page", "download-file", "play-video", "pause-video",
  "hover-tooltip", "resize-panel", "drag-item", "drop-item",
  "pin-widget", "unpin-widget", "bookmark-page", "rate-item",
];

const CONVERSION_TYPES = [
  "signup", "purchase", "subscription", "upgrade", "referral",
  "download", "trial-start", "newsletter-sub", "demo-request",
  "plan-change", "addon-purchase", "checkout-complete",
];

const EVENT_TYPES = [
  "session-start", "session-end", "error-boundary", "feature-flag",
  "ab-test-view", "onboarding-step", "search-query", "filter-apply",
  "notification-click", "feedback-submit", "theme-change",
  "locale-switch", "integration-connect", "webhook-test",
];

function randomFrom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function randomProjectId(): string {
  const prefixes = ["proj", "app", "site", "dapp", "platform"];
  return `${randomFrom(prefixes)}-${randomString(6)}`.slice(0, 40);
}

function randomPagePath(): string {
  return randomFrom(PAGE_PATHS);
}

function randomActionTarget(): string {
  const targets = [
    "btn-primary", "nav-link", "card-header", "sidebar-toggle",
    "search-input", "user-avatar", "notification-bell", "settings-gear",
    "help-icon", "footer-link", "tab-panel", "dropdown-menu",
  ];
  return randomFrom(targets);
}

function randomPayload(): string {
  const payloads = [
    `{"browser":"chrome","os":"linux","viewport":"1920x1080"}`,
    `{"step":${randomInt(1, 5)},"completed":true,"duration_ms":${randomInt(200, 5000)}}`,
    `{"query":"${randomString(8)}","results":${randomInt(0, 100)}}`,
    `{"variant":"${randomString(4)}","group":"control"}`,
    `{"error_code":${randomInt(400, 503)},"path":"${randomFrom(PAGE_PATHS)}"}`,
    `{"theme":"dark","lang":"en","tz":"UTC+${randomInt(0, 12)}"}`,
    `{"ref":"${randomString(6)}","campaign":"${randomString(8)}"}`,
  ];
  return randomFrom(payloads);
}

// ---------------------------------------------------------------------------
// Contract interaction definitions
// ---------------------------------------------------------------------------

interface Interaction {
  contract: string;
  func: string;
  argsGen: (senderAddress: string) => ClarityValue[];
}

const CONTRACTS: { [key: string]: Omit<Interaction, "contract">[] } = {
  "analytics-tracker": [
    {
      func: "track-page-view",
      argsGen: () => [
        stringAsciiCV(randomProjectId()),
        stringUtf8CV(randomPagePath()),
      ],
    },
    {
      func: "track-action",
      argsGen: () => [
        stringAsciiCV(randomProjectId()),
        stringAsciiCV(randomFrom(ACTION_NAMES)),
        stringUtf8CV(randomActionTarget()),
      ],
    },
    {
      func: "track-conversion",
      argsGen: () => [
        stringAsciiCV(randomProjectId()),
        stringAsciiCV(randomFrom(CONVERSION_TYPES)),
        uintCV(randomInt(100, 1000000)),
      ],
    },
    {
      func: "track-custom-event",
      argsGen: () => [
        stringAsciiCV(randomProjectId()),
        stringAsciiCV(randomFrom(EVENT_TYPES)),
        stringUtf8CV(randomPayload()),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Main burst-mode execution
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: npx ts-node interact_analytics_tracker.ts <start_index> <end_index>",
    );
    process.exit(1);
  }

  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error("Missing MNEMONIC in .env");
    process.exit(1);
  }

  const startIndex = parseInt(args[0], 10);
  const endIndex = parseInt(args[1], 10);
  if (
    Number.isNaN(startIndex) ||
    Number.isNaN(endIndex) ||
    startIndex > endIndex
  ) {
    console.error("Invalid wallet index range.");
    process.exit(1);
  }

  const walletCount = endIndex - startIndex + 1;

  console.log(`Interacting with Analytics Tracker (Burst Mode)...`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}`);
  console.log(`Wallets: ${startIndex} - ${endIndex}`);
  console.log(`Transactions to sign: ${walletCount}`);
  console.log(`Fee per transaction: ${TX_FEE_MICROSTX} uSTX`);
  console.log(
    `Hiro quota mode: ${HAS_HIRO_API_KEY ? "authenticated" : "unauthenticated"} (${HIRO_RPM_LIMIT} RPM cap)`,
  );
  console.log(
    `Target utilization: ${Math.round(HIRO_TARGET_UTILIZATION * 100)}% (${EFFECTIVE_RPM_BUDGET} RPM)`,
  );
  console.log(
    `Nonce batching: size=${NONCE_BATCH_SIZE}, delay=${NONCE_BATCH_DELAY_MS}ms`,
  );
  console.log(
    `Broadcast batching: size=${BROADCAST_BATCH_SIZE}, delay=${BROADCAST_BATCH_DELAY_MS}ms`,
  );
  console.log(`Broadcast retries: ${BROADCAST_RETRIES}`);

  const nonceConfiguredRpm =
    NONCE_BATCH_DELAY_MS > 0
      ? Math.floor((NONCE_BATCH_SIZE * 60000) / NONCE_BATCH_DELAY_MS)
      : Infinity;
  const broadcastConfiguredRpm =
    BROADCAST_BATCH_DELAY_MS > 0
      ? Math.floor((BROADCAST_BATCH_SIZE * 60000) / BROADCAST_BATCH_DELAY_MS)
      : Infinity;

  if (nonceConfiguredRpm > EFFECTIVE_RPM_BUDGET) {
    console.warn(
      `Nonce config exceeds budget: ~${nonceConfiguredRpm} RPM > target ${EFFECTIVE_RPM_BUDGET} RPM`,
    );
  }
  if (broadcastConfiguredRpm > EFFECTIVE_RPM_BUDGET) {
    console.warn(
      `Broadcast config exceeds budget: ~${broadcastConfiguredRpm} RPM > target ${EFFECTIVE_RPM_BUDGET} RPM`,
    );
  }
  console.log(`Network: ${STACKS_API_URL}`);

  let wallet = await generateWallet({
    secretKey: mnemonic,
    password: "",
  });

  let currentCount = wallet.accounts.length;
  while (currentCount <= endIndex) {
    const newWallet = await generateNewAccount(wallet);
    Object.assign(wallet, newWallet);
    currentCount = wallet.accounts.length;
  }

  const walletIndexes = Array.from(
    { length: walletCount },
    (_, offset) => startIndex + offset,
  );
  const contractNames = Object.keys(CONTRACTS);

  const selectedInteractions = walletIndexes.map((walletIndex) => {
    const account = wallet.accounts[walletIndex];
    const address = privateKeyToAddress(account.stxPrivateKey, "mainnet");

    const randomContractName =
      contractNames[randomInt(0, contractNames.length - 1)];
    const potentialFunctions = CONTRACTS[randomContractName];
    const randomFuncDef =
      potentialFunctions[randomInt(0, potentialFunctions.length - 1)];

    let functionArgs: ClarityValue[];
    try {
      functionArgs = randomFuncDef.argsGen(address);
    } catch (e: any) {
      throw new Error(
        `Failed to generate args for wallet ${walletIndex}, ${randomContractName}.${randomFuncDef.func}: ${e?.message || String(e)}`,
      );
    }

    return {
      walletIndex,
      account,
      address,
      contractName: randomContractName,
      functionName: randomFuncDef.func,
      functionArgs,
    };
  });

  console.log(`Prepared ${selectedInteractions.length} transaction intents.`);
  console.log("Fetching nonces in controlled batches...");

  const noncesByWalletIndex = new Map<number, bigint>();

  const uniqueWalletIndexes = new Set(
    selectedInteractions.map((i) => i.walletIndex),
  );
  if (uniqueWalletIndexes.size !== selectedInteractions.length) {
    throw new Error(
      "Duplicate wallet detected in selected interactions. Aborting.",
    );
  }

  const nonceResults = await runInBatches(
    selectedInteractions,
    NONCE_BATCH_SIZE,
    NONCE_BATCH_DELAY_MS,
    "Nonce fetch",
    async ({ walletIndex, address }) => {
      const nonce = await fetchNonce(address);
      noncesByWalletIndex.set(walletIndex, nonce);
    },
  );

  const nonceFailures = nonceResults.filter(
    (result) => result.status === "rejected",
  ).length;
  if (nonceFailures > 0) {
    console.warn(
      `Failed to fetch nonce for ${nonceFailures} wallet(s); those txs will be skipped.`,
    );
  }

  const signTargets = selectedInteractions.filter(({ walletIndex }) =>
    noncesByWalletIndex.has(walletIndex),
  );

  const uniqueSignTargets = new Set(signTargets.map((i) => i.walletIndex));
  if (uniqueSignTargets.size !== signTargets.length) {
    throw new Error("Duplicate wallet detected in sign targets. Aborting.");
  }

  console.log(`Signing ${signTargets.length} transaction(s)...`);

  const signedResults = await Promise.allSettled(
    signTargets.map(async (target) => {
      const transaction = await makeContractCall({
        contractAddress: DEPLOYER_ADDRESS,
        contractName: target.contractName,
        functionName: target.functionName,
        functionArgs: target.functionArgs,
        senderKey: target.account.stxPrivateKey,
        network,
        nonce: noncesByWalletIndex.get(target.walletIndex)!,
        fee: TX_FEE_MICROSTX,
      });

      return {
        ...target,
        transaction,
      };
    }),
  );

  const signedPayloads: Array<{
    walletIndex: number;
    address: string;
    contractName: string;
    functionName: string;
    transaction: Awaited<ReturnType<typeof makeContractCall>>;
  }> = [];
  for (const result of signedResults) {
    if (result.status === "fulfilled") {
      signedPayloads.push(result.value);
    }
  }

  const uniqueSignedWallets = new Set(signedPayloads.map((i) => i.walletIndex));
  if (uniqueSignedWallets.size !== signedPayloads.length) {
    throw new Error("Duplicate wallet detected in signed payloads. Aborting.");
  }

  const signFailures = signedResults.length - signedPayloads.length;
  if (signFailures > 0) {
    console.warn(`Failed to sign ${signFailures} transaction(s).`);
  }

  console.log(
    `Broadcasting ${signedPayloads.length} transaction(s) in batches...`,
  );

  const broadcastResults = await runInBatches(
    signedPayloads,
    BROADCAST_BATCH_SIZE,
    BROADCAST_BATCH_DELAY_MS,
    "Broadcast",
    async (payload) => {
      const response = await broadcastWithRetry(payload.transaction);
      return {
        ...payload,
        response,
      };
    },
  );

  let successCount = 0;
  let broadcastFailureCount = 0;

  for (const result of broadcastResults) {
    if (result.status === "rejected") {
      broadcastFailureCount += 1;
      console.error(`BROADCAST ERROR: ${result.reason}`);
      continue;
    }

    const { walletIndex, contractName, functionName, response } = result.value;
    if ("error" in response) {
      broadcastFailureCount += 1;
      console.error(
        `[${walletIndex}] ${contractName}.${functionName} FAILED: ${response.error} - ${response.reason}`,
      );
      continue;
    }

    successCount += 1;
    console.log(
      `[${walletIndex}] ${contractName}.${functionName} SUCCESS: ${response.txid}`,
    );
  }

  console.log("Burst complete.");
  console.log(`Requested: ${walletCount}`);
  console.log(`Signed: ${signedPayloads.length}`);
  console.log(`Broadcast success: ${successCount}`);
  console.log(
    `Failures: nonce=${nonceFailures}, sign=${signFailures}, broadcast=${broadcastFailureCount}`,
  );
}

main().catch(console.error);
