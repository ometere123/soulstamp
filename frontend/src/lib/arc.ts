import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";

export const ARC_CHAIN_ID = 5_042_002;
export const ARC_CHAIN_HEX = `0x${ARC_CHAIN_ID.toString(16)}`;
export const ARC_RPC_URL = (import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.io").trim();
export const ARC_EXPLORER_URL = (import.meta.env.VITE_ARC_EXPLORER_URL || "https://explorer.testnet.arc.io").trim();
export const ARC_USDC_ADDRESS = (import.meta.env.VITE_ARC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000") as Address;
export const ARC_ESCROW_ADDRESS = (import.meta.env.VITE_ARC_ESCROW_ADDRESS || "0xe2a0118847cbf424dbd6f5761987624ea7aae72e") as Address;
export const USDC_DECIMALS = 6;
export const ASSESSMENT_PRICE_USDC = 1_000_000n;

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER_URL } },
});

export const usdcAbi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const escrowAbi = parseAbi([
  "function deposit(bytes32 requestId,address subject,bytes32 policyHash,uint256 nonce,uint256 intentExpiry) returns (bytes32)",
  "function getPayment(bytes32 requestId) view returns (bytes32 requestId,address payer,address subject,bytes32 policyHash,uint256 amount,uint256 nonce,uint256 intentExpiry,uint256 depositedAt,uint8 status)",
  "function refund(bytes32 requestId)",
  "function price() view returns (uint256)",
  "function liabilitiesSolvent() view returns (bool)",
  "event PaymentDeposited(bytes32 indexed requestId,address indexed payer,address indexed subject,bytes32 policyHash,uint256 amount,uint256 intentExpiry,uint256 nonce)",
  "event PaymentSettled(bytes32 indexed requestId,bytes32 indexed assessmentId,address indexed subject,bytes32 policyHash,uint8 outcome,bytes32 resultCommitment)",
  "event PaymentRefunded(bytes32 indexed requestId,address indexed payer,address indexed subject,uint256 amount)",
]);

const paymentDepositedEvent = parseAbiItem("event PaymentDeposited(bytes32 indexed requestId,address indexed payer,address indexed subject,bytes32 policyHash,uint256 amount,uint256 intentExpiry,uint256 nonce)");
const paymentRefundedEvent = parseAbiItem("event PaymentRefunded(bytes32 indexed requestId,address indexed payer,address indexed subject,uint256 amount)");
const paymentDepositedSelector = toEventSelector(paymentDepositedEvent);
const paymentRefundedSelector = toEventSelector(paymentRefundedEvent);

export type ArcPaymentRecord = {
  requestId: `0x${string}`;
  payer: Address;
  subject: Address;
  policyHash: `0x${string}`;
  amount: bigint;
  nonce: bigint;
  intentExpiry: bigint;
  depositedAt: bigint;
  status: number;
};

export type ArcDepositReference = {
  transactionHash: Hash;
  logIndex: number;
  blockNumber: bigint;
  source?: "v4-request-state" | "bounded-log-scan";
};

export function boundedArcLogRanges(latest: bigint, maxScan = 100_000n, windowSize = 10_000n): Array<{ fromBlock: bigint; toBlock: bigint }> {
  if (latest < 0n || maxScan <= 0n || windowSize <= 0n) return [];
  const lowerBound = latest > maxScan ? latest - maxScan + 1n : 0n;
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let end = latest; end >= lowerBound; end = end > windowSize ? end - windowSize : 0n) {
    const start = end >= windowSize - 1n ? end - (windowSize - 1n) : 0n;
    const fromBlock = start < lowerBound ? lowerBound : start;
    ranges.push({ fromBlock, toBlock: end });
    if (fromBlock === lowerBound) break;
  }
  return ranges;
}

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function provider(): Eip1193 {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No injected EVM wallet detected.");
  return window.ethereum as Eip1193;
}

function address(value: string, label: string): Address {
  const clean = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) throw new Error(`${label} is not configured.`);
  return clean as Address;
}

export function arcExplorerTx(hash: string): string {
  return `${ARC_EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}`;
}

export async function ensureArcNetwork(): Promise<void> {
  const wallet = provider();
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw error;
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: ARC_CHAIN_HEX,
        chainName: "Arc Testnet",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: [ARC_RPC_URL],
        blockExplorerUrls: [ARC_EXPLORER_URL],
      }],
    });
  }
  const chainId = String(await wallet.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== ARC_CHAIN_HEX.toLowerCase()) throw new Error("Arc Testnet 5042002 is required for payment.");
}

async function assertArcWallet(expectedAddress: Address): Promise<void> {
  const wallet = provider();
  const chainId = String(await wallet.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== ARC_CHAIN_HEX.toLowerCase()) throw new Error("Wallet is not on Arc Testnet 5042002.");
  const accounts = await wallet.request({ method: "eth_accounts" }) as string[];
  const active = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
  if (!active || active.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("The connected wallet account changed. Reconnect the original payer before continuing.");
  }
}

function escrowAddress(): Address {
  return address(ARC_ESCROW_ADDRESS, "Arc escrow address");
}

export function getArcPublicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });
}

function getArcWalletClient(addressValue: Address) {
  return createWalletClient({ account: addressValue, chain: arcTestnet, transport: custom(provider()) });
}

export async function readArcPayment(requestKey: `0x${string}`) {
  const raw = await getArcPublicClient().readContract({
    address: escrowAddress(),
    abi: escrowAbi,
    functionName: "getPayment",
    args: [requestKey],
  });
  if (Array.isArray(raw)) {
    return {
      requestId: raw[0] as `0x${string}`,
      payer: raw[1] as Address,
      subject: raw[2] as Address,
      policyHash: raw[3] as `0x${string}`,
      amount: BigInt(raw[4] as bigint),
      nonce: BigInt(raw[5] as bigint),
      intentExpiry: BigInt(raw[6] as bigint),
      depositedAt: BigInt(raw[7] as bigint),
      status: Number(raw[8]),
    } satisfies ArcPaymentRecord;
  }
  return raw as unknown as ArcPaymentRecord;
}

/** Recover a deposit after a browser interruption from the escrow record and
 * its authenticated PaymentDeposited log. No second payment is submitted. */
export async function findArcDepositReference(requestKey: `0x${string}`, known?: Partial<ArcDepositReference>): Promise<ArcDepositReference> {
  if (known?.transactionHash && known.logIndex !== undefined && known.blockNumber !== undefined) {
    return {
      transactionHash: known.transactionHash,
      logIndex: Number(known.logIndex),
      blockNumber: BigInt(known.blockNumber),
      source: "v4-request-state",
    };
  }
  const client = getArcPublicClient();
  const latest = await client.getBlockNumber();
  for (const { fromBlock, toBlock } of boundedArcLogRanges(latest)) {
    try {
      const logs = await client.getLogs({
        address: escrowAddress(),
        event: paymentDepositedEvent,
        args: { requestId: requestKey },
        fromBlock,
        toBlock,
      });
      const log = logs[logs.length - 1];
      if (log?.transactionHash && log.logIndex !== undefined && log.blockNumber !== undefined) {
        return { transactionHash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: log.blockNumber, source: "bounded-log-scan" };
      }
    } catch {
      // Public RPC providers may reject a range or prune old history. Keep the
      // scan bounded and continue; a V4 request-state reference is authoritative
      // once confirm_arc_payment has accepted the deposit.
    }
  }
  throw new Error("Arc escrow contains a deposit but no bounded PaymentDeposited log was recoverable. Resume with the V4-recorded deposit reference or a provider with that bounded history.");
}

export async function readArcBalance(wallet: string): Promise<bigint> {
  return getArcPublicClient().readContract({
    address: address(ARC_USDC_ADDRESS, "Arc USDC"),
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [address(wallet, "Wallet")],
  });
}

async function waitForArcReceipt(hash: Hash): Promise<TransactionReceipt> {
  const receipt = await getArcPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`Arc transaction ${hash} reverted.`);
  return receipt;
}

export type ArcDepositResult = {
  approvalHash?: Hash;
  depositHash: Hash;
  receipt: TransactionReceipt;
  logIndex: number;
  requestKey: `0x${string}`;
};

export async function payAssessment(
  wallet: string,
  requestKey: `0x${string}`,
  subject: string,
  policyHash: `0x${string}`,
  nonce: bigint,
  intentExpiry: bigint,
): Promise<ArcDepositResult> {
  const payer = address(wallet, "Payer");
  const subjectAddress = address(subject, "Subject");
  await ensureArcNetwork();
  await assertArcWallet(payer);
  const escrow = escrowAddress();
  const usdc = address(ARC_USDC_ADDRESS, "Arc USDC");
  const walletClient = getArcWalletClient(payer);
  const publicClient = getArcPublicClient();
  const allowance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "allowance", args: [payer, escrow] });
  let approvalHash: Hash | undefined;
  if (allowance < ASSESSMENT_PRICE_USDC) {
    await assertArcWallet(payer);
    const approval = await walletClient.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [escrow, ASSESSMENT_PRICE_USDC] });
    approvalHash = approval;
    await waitForArcReceipt(approval);
  }
  await assertArcWallet(payer);
  const depositHash = await walletClient.writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "deposit",
    args: [requestKey, subjectAddress, policyHash, nonce, intentExpiry],
  });
  const receipt = await waitForArcReceipt(depositHash);
  const event = receipt.logs
    .map((log, index) => ({ log, index }))
    .find(({ log }) => log.address.toLowerCase() === escrow.toLowerCase() && log.topics[0]?.toLowerCase() === paymentDepositedSelector.toLowerCase());
  if (!event) throw new Error("Successful Arc receipt did not contain PaymentDeposited.");
  return { approvalHash, depositHash, receipt, logIndex: Number(event.log.logIndex ?? event.index), requestKey };
}

export async function refundArcPayment(wallet: string, requestKey: `0x${string}`): Promise<{ refundHash: Hash; receipt: TransactionReceipt; logIndex: number }> {
  const payer = address(wallet, "Refund wallet");
  await ensureArcNetwork();
  await assertArcWallet(payer);
  const walletClient = getArcWalletClient(payer);
  const escrow = escrowAddress();
  await assertArcWallet(payer);
  const refundHash = await walletClient.writeContract({ address: escrow, abi: escrowAbi, functionName: "refund", args: [requestKey] });
  const receipt = await waitForArcReceipt(refundHash);
  const event = receipt.logs
    .map((log, index) => ({ log, index }))
    .find(({ log }) => log.address.toLowerCase() === escrow.toLowerCase() && log.topics[0]?.toLowerCase() === paymentRefundedSelector.toLowerCase());
  if (!event) throw new Error("Successful Arc refund did not contain PaymentRefunded.");
  return { refundHash, receipt, logIndex: Number(event.log.logIndex ?? event.index) };
}

export function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
