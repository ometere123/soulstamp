import { createAccount } from "genlayer-js";

const privateKey = process.env.GENLAYER_PRIVATE_KEY;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("GENLAYER_PRIVATE_KEY must be a 32-byte 0x-prefixed environment secret");
}

process.stdout.write(createAccount(privateKey).address);
