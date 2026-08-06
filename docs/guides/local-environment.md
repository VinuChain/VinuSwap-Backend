# Local Environment Setup

This guide walks through setting up a local development environment for VinuSwap.

## Prerequisites

- **Node.js** 16.x or higher
- **npm** or **yarn**
- **Git**

## Clone the Repository

```bash
git clone https://github.com/VinuChain/VinuSwap-VinuChain.git
cd VinuSwap-VinuChain
```

## Install Dependencies

```bash
npm install
```

This installs:
- Hardhat development framework
- Solidity compiler
- TypeScript and type generators
- Testing utilities

## Compile Contracts

```bash
npx hardhat compile
```

This generates:
- Compiled artifacts in `artifacts/`
- TypeChain type definitions in `typechain-types/`

## Run Tests

```bash
npm run test
```

Or run specific tests:

```bash
node scripts/run_hardhat_with_ts_node_files.js test test/core/UniswapV3Factory.spec.ts --trace
```

## Start Local Network

```bash
npx hardhat node
```

This starts a local Hardhat node with:
- 80 test accounts (override with HARDHAT_ACCOUNTS_COUNT)
- Block time: instant
- Chain ID: 31337

## Deploy to Local Network

In a new terminal:

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

## Project Structure

```
VinuSwap-VinuChain/
├── contracts/
│   ├── core/               # Core pool contracts
│   │   ├── VinuSwapFactory.sol
│   │   ├── VinuSwapPool.sol
│   │   └── interfaces/
│   ├── periphery/          # User-facing contracts
│   │   ├── SwapRouter.sol
│   │   ├── NonfungiblePositionManager.sol
│   │   └── ...
│   └── extra/              # Utilities
│       ├── WETH9.sol
│       └── PoolInitHelper.sol
├── scripts/
│   ├── deploy.ts           # Full deployment
│   └── main_scripts/       # Modular scripts
├── sdk/
│   ├── core.ts             # TypeScript SDK
│   └── utils.ts            # Utilities
├── test/
│   ├── core/               # Core contract tests
│   └── periphery/          # Periphery tests
└── hardhat.config.ts       # Hardhat configuration
```

## Hardhat Configuration

The `hardhat.config.ts` includes:

```typescript
const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    overrides: {
      // Lower optimization for large contracts
      "contracts/periphery/NonfungiblePositionManager.sol": {
        version: "0.7.6",
        settings: { optimizer: { enabled: true, runs: 1 } },
      },
    },
  },
  networks: {
    hardhat: {
      accounts: { count: 80 },
    },
    vinu: {
      url: process.env.VINUSWAP_RPC_URL || "https://rpc.vinuchain.org",
      accounts: vinuOwnerPrivateKey ? [vinuOwnerPrivateKey] : [],
    },
  },
};
```

## Environment Variables

Create a `.env` file:

```bash
# VinuChain RPC endpoint
VINUSWAP_RPC_URL=https://rpc.vinuchain.org

# Deployer private key (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Optional: Etherscan API key for verification
ETHERSCAN_API_KEY=your_api_key
```

## TypeScript SDK Setup

The SDK is in the `sdk/` directory:

```typescript
import VinuSwap from './sdk/core';

// Create SDK instance
const vinuSwap = await VinuSwap.create(
    tokenA,
    tokenB,
    poolAddress,
    quoterAddress,
    routerAddress,
    positionManagerAddress,
    provider
);

// Connect signer for transactions
const connected = vinuSwap.connect(signer);
```

## Development Workflow

### 1. Make Contract Changes

Edit contracts in `contracts/` directory.

### 2. Compile

```bash
npx hardhat compile
```

### 3. Run Affected Tests

```bash
node scripts/run_hardhat_with_ts_node_files.js test test/path/to/test.spec.ts --trace
```

### 4. Run Full Test Suite

```bash
npm run test
```

### 5. Deploy to Local Network

```bash
npx hardhat node
npx hardhat run scripts/deploy.ts --network localhost
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `npx hardhat compile` | Compile contracts |
| `npm run test` | Run all tests |
| `npx hardhat node` | Start local node |
| `npx hardhat clean` | Clear artifacts |
| `npx hardhat size-contracts` | Check contract sizes |

## Common Issues

### Compilation Errors

If you see "Contract code size exceeds limit":

1. Check `hardhat.config.ts` for optimizer settings
2. Ensure `runs` is set to 1 for large contracts
3. Consider splitting functionality

### Test Timeouts

Increase Mocha timeout in `hardhat.config.ts`:

```typescript
mocha: {
    timeout: 100000
}
```

### TypeChain Issues

Regenerate types:

```bash
npx hardhat clean
npx hardhat compile
```

## IDE Setup

### VS Code

Recommended extensions:
- Solidity (Juan Blanco)
- Hardhat Solidity
- ESLint
- Prettier

Settings (`.vscode/settings.json`):

```json
{
  "solidity.packageDefaultDependenciesContractsDirectory": "contracts",
  "solidity.packageDefaultDependenciesDirectory": "node_modules",
  "editor.formatOnSave": true
}
```

## Next Steps

- [Executing Swaps](swapping.md) - Implement token swaps
- [Providing Liquidity](providing-liquidity.md) - Create positions
- [Deployment Guide](../deployment/overview.md) - Deploy to VinuChain
