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

# Create .env file
cp .env.example .env
```

### Environment Variables

```bash
# .env
VINUSWAP_RPC_URL=https://rpc.vinuchain.org
PRIVATE_KEY=your_deployer_private_key

# Optional
ETHERSCAN_API_KEY=your_api_key_for_verification
```

### Deployer Account

Ensure the deployer account has sufficient native tokens for gas:

- **VinuChain**: Minimum 1000 VINU recommended
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

- [ ] Verify all contracts on explorer
- [ ] Create initial pools
- [ ] Initialize pools with starting prices
- [ ] Set protocol fees
- [ ] Test swap on each pool
- [ ] Test position creation
- [ ] Update frontend with addresses

## Contract Addresses Template

After deployment, document addresses:

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
