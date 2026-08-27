# Deploying to VinuChain

Step-by-step guide for deploying VinuSwap to VinuChain.

## Network Configuration

### Add VinuChain to Hardhat

The network is already configured in `hardhat.config.ts`:

```typescript
networks: {
    vinu: {
        url: process.env.VINUSWAP_RPC_URL || 'https://rpc.vinuchain.org',
        // VINUSWAP_OWNER_PRIVATE_KEY, falling back to PRIVATE_KEY (see .env.example)
        accounts: vinuOwnerPrivateKey ? [vinuOwnerPrivateKey] : [],
        chainId: 207 // pinned so a wrong RPC cannot sign for another chain
    }
}
```

### Verify Connection

```bash
npx hardhat console --network vinu

# In console:
> const balance = await ethers.provider.getBalance(await ethers.getSigner().then(s => s.getAddress()))
> console.log(ethers.utils.formatEther(balance))
```

## Step 1: Deploy Fee Managers

### Deploy TieredDiscount

```typescript
// scripts/deploy/01_fee_managers.ts
import { ethers } from 'hardhat';

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log('Deploying with:', deployer.address);

    // Discount token address (your protocol token)
    const DISCOUNT_TOKEN = '0x...';

    // Thresholds and discounts (example values; the live mainnet table is
    // 100B/500B/1T/5T/10T VINU -> 5/10/25/50/75%, see OWNERSHIP.md)
    const thresholds = [
        ethers.utils.parseEther('1000'),
        ethers.utils.parseEther('10000'),
        ethers.utils.parseEther('100000'),
        ethers.utils.parseEther('1000000')
    ];
    const discounts = [100, 200, 300, 400]; // 1%, 2%, 3%, 4%

    // Deploy TieredDiscount
    const TieredDiscount = await ethers.getContractFactory('TieredDiscount');
    const tieredDiscount = await TieredDiscount.deploy(
        DISCOUNT_TOKEN,
        thresholds,
        discounts
    );
    await tieredDiscount.deployed();

    console.log('TieredDiscount:', tieredDiscount.address);

    // Deploy NoDiscount (passthrough)
    const NoDiscount = await ethers.getContractFactory('NoDiscount');
    const noDiscount = await NoDiscount.deploy();
    await noDiscount.deployed();

    console.log('NoDiscount:', noDiscount.address);

    return { tieredDiscount, noDiscount };
}

main();
```

## Step 2: Deploy Core Infrastructure

### Deploy Controller and Factory

```typescript
// scripts/deploy/02_core.ts
import { ethers } from 'hardhat';

async function main() {
    const [deployer] = await ethers.getSigners();

    // Fee distribution accounts
    const accounts = [
        '0x...', // Treasury
        '0x...', // Dev fund
        '0x...'  // Burn address or other
    ];
    const shares = [2, 2, 1]; // 40%, 40%, 20%

    // Deploy VinuSwapFactory
    const VinuSwapFactory = await ethers.getContractFactory('VinuSwapFactory');
    const factory = await VinuSwapFactory.deploy();
    await factory.deployed();

    console.log('VinuSwapFactory:', factory.address);

    // Deploy Controller
    const Controller = await ethers.getContractFactory('Controller');
    const controller = await Controller.deploy(
        accounts,
        shares
    );
    await controller.deployed();

    console.log('Controller:', controller.address);

    // Transfer Factory ownership to Controller
    await factory.setOwner(controller.address);
    console.log('Factory ownership transferred to Controller');

    return { factory, controller };
}

main();
```

## Step 3: Deploy Periphery

### Deploy SwapRouter

```typescript
// scripts/deploy/03_router.ts
async function main() {
    const FACTORY = '0x...';  // From step 2
    const WVC = '0x...';      // VinuChain WVC (Wrapped VC)

    const SwapRouter = await ethers.getContractFactory('SwapRouter');
    const router = await SwapRouter.deploy(FACTORY, WVC);
    await router.deployed();

    console.log('SwapRouter:', router.address);
}
```

### Deploy Position Manager

```typescript
// scripts/deploy/04_position_manager.ts
async function main() {
    const FACTORY = '0x...';
    const WVC = '0x...';      // VinuChain WVC (Wrapped VC)

    // Deploy NFTDescriptor library first
    const NFTDescriptor = await ethers.getContractFactory('NFTDescriptor');
    const nftDescriptor = await NFTDescriptor.deploy();
    await nftDescriptor.deployed();

    console.log('NFTDescriptor:', nftDescriptor.address);

    // Deploy NonfungibleTokenPositionDescriptor
    const NonfungibleTokenPositionDescriptor = await ethers.getContractFactory(
        'NonfungibleTokenPositionDescriptor',
        {
            libraries: {
                NFTDescriptor: nftDescriptor.address
            }
        }
    );

    // Native currency label: MUST be "VC". The live descriptor was deployed
    // with 'VinuSwap Position' here and cannot be changed (see OWNERSHIP.md).
    const nativeCurrencyLabel = ethers.utils.formatBytes32String('VC');

    const descriptor = await NonfungibleTokenPositionDescriptor.deploy(
        WVC,
        nativeCurrencyLabel
    );
    await descriptor.deployed();

    console.log('NonfungibleTokenPositionDescriptor:', descriptor.address);

    // Deploy NonfungiblePositionManager
    const NonfungiblePositionManager = await ethers.getContractFactory(
        'NonfungiblePositionManager'
    );
    const positionManager = await NonfungiblePositionManager.deploy(
        FACTORY,
        WVC,
        descriptor.address
    );
    await positionManager.deployed();

    console.log('NonfungiblePositionManager:', positionManager.address);
}
```

### Deploy Quoter

```typescript
// scripts/deploy/05_quoter.ts
async function main() {
    const FACTORY = '0x...';
    const WVC = '0x...';      // VinuChain WVC (Wrapped VC)

    const VinuSwapQuoter = await ethers.getContractFactory('VinuSwapQuoter');
    const quoter = await VinuSwapQuoter.deploy(FACTORY, WVC);
    await quoter.deployed();

    console.log('VinuSwapQuoter:', quoter.address);
}
```

## Step 4: Deploy Utilities

### Deploy PoolInitHelper

```typescript
// scripts/deploy/06_utilities.ts
async function main() {
    const PoolInitHelper = await ethers.getContractFactory('PoolInitHelper');
    const poolInitHelper = await PoolInitHelper.deploy();
    await poolInitHelper.deployed();

    console.log('PoolInitHelper:', poolInitHelper.address);

    // Get init code hash for address computation
    const hash = await poolInitHelper.getInitCodeHash();
    console.log('Pool init code hash:', hash);
    // Live factory 0xd74dEe1C...: 0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e
    // Any periphery deployed against it must embed that value in PoolAddress.sol.
}
```

## Complete Deployment Script

```typescript
// scripts/deploy_all.ts
import { ethers } from 'hardhat';

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log('Deploying VinuSwap with account:', deployer.address);
    console.log('Account balance:', ethers.utils.formatEther(
        await deployer.getBalance()
    ));

    // Configuration
    const config = {
        WVC: '0x...', // Existing WVC (Wrapped VC) on VinuChain
        DISCOUNT_TOKEN: '0x...',
        FEE_ACCOUNTS: ['0x...', '0x...'],
        FEE_SHARES: [1, 1],
        NATIVE_LABEL: 'VC'
    };

    const deployed: Record<string, string> = {};

    // 1. Fee Managers
    console.log('\n--- Deploying Fee Managers ---');

    const TieredDiscount = await ethers.getContractFactory('TieredDiscount');
    const tieredDiscount = await TieredDiscount.deploy(
        config.DISCOUNT_TOKEN,
        [
            ethers.utils.parseEther('1000'),
            ethers.utils.parseEther('10000'),
            ethers.utils.parseEther('100000'),
            ethers.utils.parseEther('1000000')
        ],
        [100, 200, 300, 400]
    );
    await tieredDiscount.deployed();
    deployed.TieredDiscount = tieredDiscount.address;
    console.log('TieredDiscount:', tieredDiscount.address);

    // 2. Factory
    console.log('\n--- Deploying Factory ---');

    const VinuSwapFactory = await ethers.getContractFactory('VinuSwapFactory');
    const factory = await VinuSwapFactory.deploy();
    await factory.deployed();
    deployed.VinuSwapFactory = factory.address;
    console.log('VinuSwapFactory:', factory.address);

    // 3. Controller
    console.log('\n--- Deploying Controller ---');

    const Controller = await ethers.getContractFactory('Controller');
    const controller = await Controller.deploy(
        config.FEE_ACCOUNTS,
        config.FEE_SHARES
    );
    await controller.deployed();
    deployed.Controller = controller.address;
    console.log('Controller:', controller.address);

    // Transfer ownership
    await factory.setOwner(controller.address);
    console.log('Factory ownership transferred');

    // 4. SwapRouter
    console.log('\n--- Deploying SwapRouter ---');

    const SwapRouter = await ethers.getContractFactory('SwapRouter');
    const router = await SwapRouter.deploy(factory.address, config.WVC);
    await router.deployed();
    deployed.SwapRouter = router.address;
    console.log('SwapRouter:', router.address);

    // 5. NFT Descriptor
    console.log('\n--- Deploying NFT Contracts ---');

    const NFTDescriptor = await ethers.getContractFactory('NFTDescriptor');
    const nftDescriptor = await NFTDescriptor.deploy();
    await nftDescriptor.deployed();
    deployed.NFTDescriptor = nftDescriptor.address;

    const Descriptor = await ethers.getContractFactory(
        'NonfungibleTokenPositionDescriptor',
        { libraries: { NFTDescriptor: nftDescriptor.address } }
    );
    const descriptor = await Descriptor.deploy(
        config.WVC,
        ethers.utils.formatBytes32String(config.NATIVE_LABEL)
    );
    await descriptor.deployed();
    deployed.NonfungibleTokenPositionDescriptor = descriptor.address;

    // 6. Position Manager
    const PositionManager = await ethers.getContractFactory(
        'NonfungiblePositionManager'
    );
    const positionManager = await PositionManager.deploy(
        factory.address,
        config.WVC,
        descriptor.address
    );
    await positionManager.deployed();
    deployed.NonfungiblePositionManager = positionManager.address;
    console.log('NonfungiblePositionManager:', positionManager.address);

    // 7. Quoter
    console.log('\n--- Deploying Quoter ---');

    const Quoter = await ethers.getContractFactory('VinuSwapQuoter');
    const quoter = await Quoter.deploy(factory.address, config.WVC);
    await quoter.deployed();
    deployed.VinuSwapQuoter = quoter.address;
    console.log('VinuSwapQuoter:', quoter.address);

    // Summary
    console.log('\n=== DEPLOYMENT COMPLETE ===');
    console.log(JSON.stringify(deployed, null, 2));

    // Save to file, then fold the result into docs/deployments/vinuchain-207.json
    const fs = require('fs');
    fs.writeFileSync(
        'docs/deployments/vinuchain-207.new.json',
        JSON.stringify({
            network: 'vinu',
            chainId: 207,
            deployer: deployer.address,
            timestamp: new Date().toISOString(),
            contracts: deployed
        }, null, 2)
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
```

## Verification

There is **no** `hardhat verify` target for VinuChain: `hardhat.config.ts` has
no etherscan/customChains entry for chain 207, and no live contract is
source-verified. Provenance is recorded instead in
[`docs/deployments/vinuchain-207.json`](../deployments/vinuchain-207.json)
(deploy tx, block, deployer nonce, runtime code keccak). Inspect contracts on
the explorer at `https://vinuexplorer.org/address/<address>` and compare
`eth_getCode` against the artifact's `deployedBytecode` (metadata stripped).

## Post-Deployment

After deployment, proceed to:

1. [Pool Creation](pool-creation.md) - Create initial pools
2. [Configuration](configuration.md) - Configure protocol settings
