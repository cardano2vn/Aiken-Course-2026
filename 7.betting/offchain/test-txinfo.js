const { BlockfrostProvider } = require("@meshsdk/core");
const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY;
if (!apiKey) { console.error("No API KEY"); process.exit(1); }
const provider = new BlockfrostProvider(apiKey);
// Get a recent tx hash from preview or preprod, wait let's just get the methods available
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(provider)));
