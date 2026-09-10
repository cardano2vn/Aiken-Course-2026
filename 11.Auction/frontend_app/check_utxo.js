const https = require('https');

const blockfrostKey = 'preprod2EkL4jB7Awsl1ugTeMg1oOID9gHLi6pd';
const txHash = '535ea4f21838ce672cc4a4b5f78e35e4cf0da68673609d8a48103a3d41ff745a';

const options = {
  hostname: 'cardano-preprod.blockfrost.io',
  path: `/api/v0/txs/${txHash}/utxos`,
  headers: {
    'project_id': blockfrostKey
  }
};

https.get(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Blockfrost Response:', data);
  });
}).on('error', err => console.error(err));
