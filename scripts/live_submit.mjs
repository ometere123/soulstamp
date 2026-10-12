import fs from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const [operation, ...args] = process.argv.slice(2);
const rpc = "https://studio.genlayer.com/api";
const privateKey = process.env.GENLAYER_PRIVATE_KEY;

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("GENLAYER_PRIVATE_KEY must be a 32-byte 0x-prefixed environment secret");
}

const account = createAccount(privateKey);
const client = createClient({ chain: studionet, endpoint: rpc, account });
let hash;

if (operation === "deploy") {
  const [codePath, admin, legacyContract] = args;
  if (!codePath || !admin || !legacyContract) throw new Error("deploy requires code path, admin, and legacy contract");
  const code = fs.readFileSync(codePath, "utf8");
  hash = await client.deployContract({ account, code, args: [admin, legacyContract] });
} else if (operation === "write") {
  const [address, functionName, encodedArgs] = args;
  if (!address || !functionName || !encodedArgs) throw new Error("write requires address, method, and JSON args");
  hash = await client.writeContract({
    account,
    address,
    functionName,
    args: JSON.parse(encodedArgs),
    value: 0n,
  });
} else {
  throw new Error(`unsupported operation: ${operation}`);
}

process.stdout.write(JSON.stringify({ hash, address: account.address }));
