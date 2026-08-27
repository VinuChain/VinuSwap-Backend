# Deployment Overview

This section covers deploying VinuSwap contracts to VinuChain and other EVM networks.

## Deployment Order

VinuSwap contracts must be deployed in a specific order due to dependencies:

```
1. Fee Management (Optional)
   └── TieredDiscount
   └── OverridableFeeManager (if needed)
   └── NoDiscount

2. Core Infrastructure
   ├── Controller (fee distribution)
   └── VinuSwapFactory

3. Periphery Contracts
   ├── SwapRouter
   ├── NFTDescriptor (library)
   ├── NonfungibleTokenPositionDescriptor
   ├── NonfungiblePositionManager
   └── VinuSwapQuoter

4. Utility
   └── WVC (if not existing)
   └── PoolInitHelper
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEPLOYMENT PHASES                                 │
└─────────────────────────────────────────────────────────────────────────────┘

Phase 1: Fee Management
┌─────────────────────────────────────────────────────────────────────────────┐
│  [TieredDiscount]         [NoDiscount]        [OverridableFeeManager]       │
│       ↓                        ↓                       ↓                    │
│   discountToken            passthrough            default + overrides       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Phase 2: Core Infrastructure
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Controller]  ←────────────→  [VinuSwapFactory]                            │
│    accounts[]                      owner = Controller                       │
│    shares[]                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Phase 3: Periphery
┌─────────────────────────────────────────────────────────────────────────────┐
│  [SwapRouter]    [PositionManager]    [Quoter]    [Descriptor]              │
│    factory         factory             factory      WVC                     │
│    WVC             WVC                 factory                              │
│                    descriptor                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Phase 4: Pool Creation
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Pool 1: WVC/USDT]     [Pool 2: WVC/TOKEN_A]  [Pool 3: USDT/TOKEN_B]      │
│    fee: 3000              fee: 3000             fee: 500                    │
│    tickSpacing: 60        tickSpacing: 60       tickSpacing: 10             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Environment Setup

```bash
# Install dependencies
npm install

# Create .env file (template lists every variable hardhat.config.ts reads)
cp .env.example .env
```

### Environment Variables

```bash
# .env — see .env.example at the repository root
VINUSWAP_OWNER_PRIVATE_KEY=   # signer for --network vinu (PRIVATE_KEY is the fallback)
VINUSWAP_RPC_URL=             # defaults to https://rpc.vinuchain.org
```

The admin scripts also read `VINUSWAP_CONFIRM`, `VINUSWAP_DEPLOYMENTS_DIR`,
`VINUSWAP_ALLOW_BYTECODE_MISMATCH`, `VINUSWAP_POOL_FEE_MANAGER`,
`VINUSWAP_DEFAULT_DISCOUNT` and `COINGECKO_DEMO_API_KEY`; see the
[rehearsal section of OWNERSHIP.md](../OWNERSHIP.md#rehearsal).

There is no explorer verification key: `hardhat.config.ts` has no verifier
configured for chain 207.

### Deployer Account

Ensure the deployer account has sufficient native currency (**VC**) for gas:

- **VinuChain**: keep a comfortable VC balance; a full deployment is ten
  contract creations plus configuration transactions
- **Testnet**: Use faucet to obtain test tokens

## Quick Deploy

### Using Deployment Script

```bash
npx hardhat run scripts/deploy.ts --network vinu
```

### Using Modular Scripts

```bash
# Deploy core
npx hardhat run scripts/main_scripts/deploy_core.ts --network vinu

# Deploy quoter
npx hardhat run scripts/main_scripts/deploy_quoter.ts --network vinu

# Create initial pool
npx hardhat run scripts/main_scripts/deploy_next_pool.ts --network vinu
```

## Deployment Checklist

### Pre-Deployment

- [ ] Compile contracts: `npx hardhat compile`
- [ ] Run tests: `npm run test`
- [ ] Verify bytecode sizes: `npx hardhat size-contracts`
- [ ] Fund deployer account
- [ ] Prepare fee manager configuration
- [ ] Prepare Controller accounts and shares

### Deployment

- [ ] Deploy fee managers
- [ ] Deploy Controller and Factory
- [ ] Transfer Factory ownership to Controller
- [ ] Deploy SwapRouter
- [ ] Deploy NFTDescriptor library
- [ ] Deploy NonfungibleTokenPositionDescriptor
- [ ] Deploy NonfungiblePositionManager
- [ ] Deploy VinuSwapQuoter
- [ ] Deploy PoolInitHelper

### Post-Deployment

- [ ] Record every address, deploy tx and block in `docs/deployments/vinuchain-207.json` (no explorer verifier exists for chain 207; compare `eth_getCode` to the artifact instead)
- [ ] Create initial pools (initialised inline by `createPool` / `createStandardPool`)
- [ ] Set protocol fees
- [ ] Test swap on each pool
- [ ] Test position creation
- [ ] Update frontend with addresses

## Contract Addresses Record

The mainnet record is
[`docs/deployments/vinuchain-207.json`](../deployments/vinuchain-207.json)
(address, deploy block, deploy tx, deployer nonce, runtime code hash, explorer
link, compiler settings, legacy sets). Extend that file after any new
deployment. Minimal shape:

```json
{
  "network": "vinu",
  "chainId": 207,
  "contracts": {
    "WVC": "0x...",
    "TieredDiscount": "0x...",
    "Controller": "0x...",
    "VinuSwapFactory": "0x...",
    "SwapRouter": "0x...",
    "NFTDescriptor": "0x...",
    "NonfungibleTokenPositionDescriptor": "0x...",
    "NonfungiblePositionManager": "0x...",
    "VinuSwapQuoter": "0x...",
    "PoolInitHelper": "0x..."
  },
  "pools": {
    "WVC_USDT_3000": "0x...",
    "WVC_TOKEN_A_3000": "0x..."
  }
}
```

## Next Steps

- [Deploying to VinuChain](vinuchain.md) - Step-by-step deployment
- [Pool Creation](pool-creation.md) - Creating and initializing pools
- [Configuration](configuration.md) - Configuring deployed contracts

## Release and Rollback

VinuSwap ships as two independently released layers:

- **Frontend / API (`VinuSwap-Frontend`)** — every push to `main` runs the
  `quality` job (lint, type check, unit/API/model tests); only a green job fires
  the Vercel production deploy hook. **Rollback:** promote the previous
  production deployment in the Vercel dashboard (instant, no build), then revert
  the offending commit on `main` so the next deploy matches. API routes are
  stateless apart from MongoDB analytics collections, which the indexer
  rebuilds idempotently from its stored checkpoints.
- **Contracts (`VinuSwap-Backend`)** — the deployed generation is immutable and
  has no rollback. A source change never alters a live contract; fixing
  deployed behaviour means a new contract generation (see the `Notes for future
  deployments` and `Source vs deployed bytecode` sections of
  [`OWNERSHIP.md`](../OWNERSHIP.md)) with a testnet rehearsal, pool and
  liquidity migration plan, and frontend registry update
  (`npm run registry:sync` in the frontend) before any user-facing switch.
  Configuration-only changes (fee policy, `createStandardPool` defaults,
  protocol-fee split) go through the preflight-guarded scripts in
  `scripts/main_scripts/` and are reversible with the same scripts.

Record every production change (frontend deploy SHA, contract configuration
transaction) against the live-state table in `OWNERSHIP.md` and the
deployment record in [`deployments/vinuchain-207.json`](../deployments/vinuchain-207.json).
