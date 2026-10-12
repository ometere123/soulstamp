import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const [address, functionName, encodedArgs, rpc = "https://studio.genlayer.com/api"] = process.argv.slice(2);
if (!address || !functionName || encodedArgs === undefined) {
  throw new Error("usage: node scripts/live_read.mjs <contract-address> <method> <json-args> [rpc]");
}

const client = createClient({ chain: studionet, endpoint: rpc });
const result = await client.readContract({
  address,
  functionName,
  args: JSON.parse(encodedArgs),
});
process.stdout.write(JSON.stringify(result, (_key, value) => (
  typeof value === "bigint" ? value.toString() : value
)));
