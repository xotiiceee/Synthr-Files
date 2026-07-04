/**
 * Example x402 client calling Synthr Cyber endpoints.
 * Use @x402/axios or fetch + signer for agents.
 * 
 * In real agent harness: the client library handles 402 automatically.
 */

import axios from 'axios';
import { withX402 } from '@x402/axios'; // or similar

// For demo (testnet). In production agent: wallet signs automatically.
const client = axios.create();
const paidClient = withX402(client, {
  // wallet or signer config here for real use
});

async function callStackBrief() {
  const res = await paidClient.post('http://localhost:3000/v1/cyber/stack-brief', {
    stack: {
      dependencies: [
        { name: "express", version: "4.18.0", ecosystem: "npm" },
        { name: "jsonwebtoken", version: "9.0.0", ecosystem: "npm" }
      ]
    },
    context: "Next.js + agent tool calling harness"
  });
  console.log('Stack Brief Response:', JSON.stringify(res.data, null, 2));
}

callStackBrief().catch(console.error);
