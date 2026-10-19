import fs from "node:fs";
import path from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { config, requireSecret, repositoryRoot } from "./env_secrets.mjs";

const RPC = "https://studio.genlayer.com/api";
const sourcePath = process.argv[2] || path.join(repositoryRoot(), "contracts", "soulstamp_trustpass.py");
const v3 = config("V3_SOULSTAMP_CONTRACT_ADDRESS", "0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d");
const escrow = config("ARC_ESCROW_ADDRESS");
const decoder = config("HUMAN_PASSPORT_DECODER_ADDRESS", "0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56");
const passportRpc = config("HUMAN_PASSPORT_RPC_URL", "https://sepolia.optimism.io");
const googleIssuer = config("GOOGLE_ATTESTATION_BASE_URL", config("V4_GOOGLE_ATTESTATION_BASE_URL", ""));
const settlementOperator = config("ARC_SETTLEMENT_OPERATOR_ADDRESS");

function validAddress(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not a 20-byte address`);
  return value;
}
validAddress(v3, "V3_SOULSTAMP_CONTRACT_ADDRESS");
validAddress(escrow, "ARC_ESCROW_ADDRESS");
validAddress(decoder, "HUMAN_PASSPORT_DECODER_ADDRESS");
if (!/^https:\/\//.test(passportRpc)) throw new Error("HUMAN_PASSPORT_RPC_URL must be HTTPS");
if (googleIssuer && !/^https:\/\//.test(googleIssuer)) throw new Error("GOOGLE_ATTESTATION_BASE_URL must be HTTPS");

const privateKey = requireSecret("GENLAYER_PRIVATE_KEY", ["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]);
const account = createAccount(privateKey);
const admin = config("V4_ADMIN_ADDRESS", config("GENLAYER_ADMIN_ADDRESS", account.address));
const operator = settlementOperator || config("ARC_SETTLEMENT_OPERATOR_ADDRESS", account.address);
validAddress(admin, "V4_ADMIN_ADDRESS");
validAddress(operator, "ARC_SETTLEMENT_OPERATOR_ADDRESS");
if (!fs.existsSync(sourcePath)) throw new Error(`Contract source not found: ${sourcePath}`);
const code = fs.readFileSync(sourcePath, "utf8");
if (!code.includes("soulstamp-v4.1-trustpass-security-correction")) throw new Error("Source does not identify SoulStamp V4.1");

const client = createClient({ chain: studionet, endpoint: RPC, account });
const hash = await client.deployContract({
  account,
  code,
  args: [v3, escrow, decoder, passportRpc, googleIssuer, operator, admin],
});
console.log(JSON.stringify({
  network: "GenLayer Studionet",
  chainId: 61999,
  signer: account.address,
  deploymentTransaction: hash,
  explorer: `https://explorer-studio.genlayer.com/tx/${hash}`,
  constructor: {
    v3Contract: v3,
    arcEscrow: escrow,
    humanPassportDecoder: decoder,
    humanPassportRpc: passportRpc,
    googleAttestationBaseUrl: googleIssuer || null,
    settlementOperator: operator,
    admin,
  },
}, null, 2));
