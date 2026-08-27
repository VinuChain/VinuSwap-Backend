# SDK Overview

The VinuSwap SDK provides a TypeScript interface for interacting with VinuSwap contracts.

## Features

- **Pool Interaction** - Query pool state and execute swaps
- **Position Management** - Create, modify, and close liquidity positions
- **Quote Generation** - Get expected swap amounts
- **Price Utilities** - Convert between prices and ticks

## Location

This reference SDK is located in the `sdk/` directory. It is a reference
implementation; the npm package the frontend runs is `vinuswap-sdk` from a
separate repository — see [Installation](installation.md) for the behavioural
differences.

```
sdk/
├── core.ts        # Main VinuSwap class
├── utils.ts       # Price and math utilities
└── abi/
    └── ERC20.json # Token ABI
```

## Quick Start

```typescript
import VinuSwap from './sdk/core';
import { encodePrice } from './sdk/utils';

// Create SDK instance
const vinuSwap = await VinuSwap.create(
    tokenA,             // Token A address
    tokenB,             // Token B address
    poolAddress,        // Pool contract address
    quoterAddress,      // Quoter contract address
    routerAddress,      // Router contract address
    positionManagerAddress,  // Position manager address
    provider            // ethers provider
);

// Connect signer for transactions
const connected = vinuSwap.connect(signer);

// Execute swap
const tx = await connected.swapExactInput(
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    recipient,
    deadline
);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Application                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       VinuSwap SDK                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │  VinuSwap   │  │   Utilities  │  │   Price Math    │    │
│  │    Class    │  │              │  │                 │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     ethers.js                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    VinuSwap Contracts                       │
│  Pool │ Router │ Position Manager │ Quoter                  │
└─────────────────────────────────────────────────────────────┘
```

## Key Classes

### VinuSwap

Main class for interacting with VinuSwap:

```typescript
class VinuSwap {
    // Contract references
    pool: VinuSwapPool;
    quoter: VinuSwapQuoter;
    router: SwapRouter;
    positionManager: NonfungiblePositionManager;

    // Token contracts
    token0Contract: ethers.Contract;
    token1Contract: ethers.Contract;

    // Factory method
    static async create(...): Promise<VinuSwap>;

    // Connection
    connect(signer: Signer): VinuSwap;

    // Operations
    async swapExactInput(...): Promise<ethers.ContractTransaction>;
    async swapExactOutput(...): Promise<ethers.ContractTransaction>;
    async quoteExactInput(...): Promise<string>;
    async quoteExactOutput(...): Promise<string>;
    async mint(...): Promise<ethers.ContractTransaction>;
}
```

## Dependencies

- **ethers.js** - Ethereum interaction
- **@uniswap/v3-sdk** - Price calculations and math
- **@uniswap/sdk-core** - Token and pool utilities

## Type Safety

The SDK is written in TypeScript with full type definitions. All swap and liquidity methods return `Promise<ethers.ContractTransaction>`; quote methods return `Promise<string>`.

## Next Steps

- [Installation](installation.md)
- [VinuSwap Class](vinuswap-class.md)
- [Utilities](utilities.md)
- [Examples](examples.md)
