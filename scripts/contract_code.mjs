import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const [address, rpc = "https://studio.genlayer.com/api"] = process.argv.slice(2);
if (!address) throw new Error("usage: node scripts/contract_code.mjs <contract-address> [rpc]");
const client = createClient({ chain: studionet, endpoint: rpc });
process.stdout.write(await client.getContractCode(address));
