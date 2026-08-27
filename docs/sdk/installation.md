# Installation

## Using the SDK

Two SDKs exist; know which one you are using.

- **Published package:** the VinuSwap frontend runs `vinuswap-sdk@0.0.21-development`
  from npm (source: https://github.com/samuelemarro/vinuswap-sdk, ethers v6,
  typechain ethers-v6). Its bundled ABIs match the deployed contracts (11-value
  `positions()`, `tokensOwed`, `quoteTokensOwed`, `lock`, IQuoterV2 quoter, no
  `flash`).
- **Reference implementation:** `sdk/` in this repository (ethers v5). It is
  **not** the build source of the npm package, and the two differ in behaviour:
  the published package compares addresses case-sensitively (no normalisation
  in `create()` / `quoteExactInput`), has no `validateSlippageRatio`, and returns
  `protocolShare0/1 = Infinity` when `feeProtocol` is 0 (every current pool)
  where `sdk/` returns 0; it also exposes extra public APIs (`positionInfo`,
  `positionIdsOwnedBy`, and the exported `PositionInfo` type).

The rest of this section documents the reference implementation in `sdk/`.

### Direct Import

```typescript
// Import from local SDK
import VinuSwap from './sdk/core';
import { encodePrice, decodePrice } from './sdk/utils';
```

### Published package

```bash
npm install vinuswap-sdk   # what the frontend uses; ethers v6
```

This repository's `package.json` name (`vinu-swap`) is the Hardhat project, not
a published SDK.

## Dependencies

Ensure these dependencies are installed:

```bash
npm install ethers@^5.7.0
npm install @uniswap/v3-sdk @uniswap/sdk-core
```

## TypeScript Configuration

The SDK requires TypeScript with ES2020 target:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": false,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

## Contract ABIs

The SDK needs contract ABIs. These are generated during compilation:

```bash
npx hardhat compile
```

ABIs are located in:
- `artifacts/contracts/core/VinuSwapPool.sol/VinuSwapPool.json`
- `artifacts/contracts/periphery/SwapRouter.sol/SwapRouter.json`
- `artifacts/contracts/periphery/NonfungiblePositionManager.sol/NonfungiblePositionManager.json`
- `artifacts/contracts/periphery/VinuSwapQuoter.sol/VinuSwapQuoter.json`

## Provider Setup

### Local Development

```typescript
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
```

### VinuChain Mainnet

```typescript
const provider = new ethers.providers.JsonRpcProvider(
    'https://rpc.vinuchain.org'
);
```

### With Signer

```typescript
// From private key
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// From browser wallet
const signer = provider.getSigner();
```

## Initialization Example

```typescript
import { ethers } from 'ethers';
import VinuSwap from './sdk/core';

// Contract addresses (from deployment)
const ADDRESSES = {
    factory: '0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe',
    quoter: '0xEed635Fa2343355d9bA726C379F2B5dEa70fE65C',
    router: '0x48f450475a8b501A7480C1Fd02935a7327F713Ad',
    positionManager: '0xF699ec0764741f66F81068665eFFAeefA3c6037a',
    wvc: '0xEd8c5530a0A086a12f57275728128a60DFf04230',      // Wrapped VC (native token)
    usdt: '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41',     // USDT on VinuChain
    pool: '0x...'       // Pool address (depends on token pair)
};

async function main() {
    // Setup provider
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // Create SDK instance
    const sdk = await VinuSwap.create(
        ADDRESSES.token0,
        ADDRESSES.token1,
        ADDRESSES.pool,
        ADDRESSES.quoter,
        ADDRESSES.router,
        ADDRESSES.positionManager,
        provider
    );

    // Connect signer
    const connected = sdk.connect(signer);

    // Ready to use
    console.log('SDK initialized');
}

main();
```

## Verification

Test your setup:

```typescript
async function verifySetup(sdk: VinuSwap) {
    // Check pool
    const slot0 = await sdk.pool.slot0();
    console.log('Current tick:', slot0.tick);

    // Check quoter
    const quote = await sdk.quoter.callStatic.quoteExactInputSingle({
        tokenIn: sdk.token0,
        tokenOut: sdk.token1,
        fee: 3000,
        amountIn: ethers.utils.parseEther('1'),
        sqrtPriceLimitX96: 0
    });
    console.log('Quote works:', quote[0].toString());

    // Check signer (if connected)
    if (sdk.signerOrProvider instanceof ethers.Signer) {
        const address = await (sdk.signerOrProvider as ethers.Signer).getAddress();
        console.log('Signer address:', address);
    }

    console.log('Setup verified!');
}
```

## Next Steps

- [VinuSwap Class](vinuswap-class.md)
- [Utilities](utilities.md)
