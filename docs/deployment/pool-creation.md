# Pool Creation

Guide for creating and initializing VinuSwap pools after contract deployment.

## Creating Pools

Pools are created through the Controller (which owns the Factory).

### Via Controller

```typescript
async function createPool(
    controller: Contract,
    factoryAddress: string,
    tokenA: string,
    tokenB: string,
    fee: number,
    tickSpacing: number,
    feeManager: string,
    sqrtPriceX96: BigNumber
) {
    const tx = await controller.createPool(
        factoryAddress,
        tokenA,
        tokenB,
        fee,
        tickSpacing,
        feeManager,
        sqrtPriceX96
    );

    const receipt = await tx.wait();
    const event = receipt.events.find((e: any) => e.event === 'PoolCreated');
    const poolAddress = event.args.pool;

    console.log('Pool created:', poolAddress);
    return poolAddress;
}
```

`createPool` is **owner-only** and initialises the pool inline (a second
`initialize` call reverts `AI`). Anyone may instead call the permissionless
`Controller.createStandardPool(factory, tokenA, tokenB, fee, sqrtPriceX96)`,
which uses the owner-set `defaultFeeManager(factory)` and
`defaultTickSpacing(factory, fee)`; fees whose default tick spacing is 0 revert
`Tick spacing not set`. Calling `factory.createPool` or `pool.initialize`
directly from an EOA reverts because the factory owner is the Controller.

### Live `createStandardPool` defaults (VinuChain 207)

The factory takes any `tickSpacing` in `1..16383`; there is no fee → tick
spacing table in the contracts. Read `pool.tickSpacing()` for an existing pool.

| Fee | `defaultTickSpacing` | `createStandardPool` |
|-----|----------------------|----------------------|
| 500 (0.05%) | 10 | enabled |
| 3000 (0.3%) | 60 | enabled |
| 10000 (1%) | 200 | enabled |
| 100 / 2500 / 5000 | 0 | **disabled** (owner `createPool` only) |

### Example Pool Creation Script

```typescript
// scripts/create_pools.ts
async function main() {
    const [deployer] = await ethers.getSigners();

    // Deployed addresses
    const CONTROLLER = '0x...';
    const FEE_MANAGER = '0x...';

    // Tokens on VinuChain
    const WVC = '0xEd8c5530a0A086a12f57275728128a60DFf04230';   // Wrapped VC
    const USDT = '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41';  // USDT
    const TOKEN_A = '0x...';  // Other token

    const controller = await ethers.getContractAt('Controller', CONTROLLER);

    // Pool configurations
    const pools = [
        {
            name: 'WVC/USDT',
            tokenA: WVC,
            tokenB: USDT,
            fee: 3000,      // 0.3%
            tickSpacing: 60,
            initialPrice: 0.5  // 1 WVC = 0.5 USDT
        },
        {
            name: 'WVC/TOKEN_A',
            tokenA: WVC,
            tokenB: TOKEN_A,
            fee: 3000,
            tickSpacing: 60,
            initialPrice: 100
        }
    ];

    const deployed: Record<string, string> = {};

    for (const pool of pools) {
        console.log(`\nCreating ${pool.name} pool...`);

        // Encode initial price before creating pool
        const sqrtPriceX96 = encodeSqrtRatioX96(pool.initialPrice);

        // Create pool (initialization is performed inside createPool)
        const tx = await controller.createPool(
            FACTORY,
            pool.tokenA,
            pool.tokenB,
            pool.fee,
            pool.tickSpacing,
            FEE_MANAGER,
            sqrtPriceX96
        );

        const receipt = await tx.wait();
        const event = receipt.events.find((e: any) => e.event === 'PoolCreated');
        const poolAddress = event.args.pool;

        console.log(`  Pool address: ${poolAddress}`);
        console.log(`  Initialized at price ${pool.initialPrice}`);
        deployed[pool.name.replace('/', '_')] = poolAddress;

        // Optional protocol fee (0 = off; 4..10 = 25%..10%). Live mainnet pools
        // on the current factory run with 0.
        await controller.setFeeProtocol(poolAddress, 5, 5);  // 20%
        console.log('  Protocol fee set to 20%');
    }

    console.log('\n=== Pools Created ===');
    console.log(JSON.stringify(deployed, null, 2));
}
```

## Initializing Pools

### Price Encoding

Convert human-readable price to sqrtPriceX96:

```typescript
import { encodeSqrtRatioX96 } from '@uniswap/v3-sdk';

// For token0/token1 price
function encodePriceForPool(
    price: number,
    token0Decimals: number,
    token1Decimals: number
): BigNumber {
    // Adjust for decimals
    const adjustedPrice = price * (10 ** token1Decimals) / (10 ** token0Decimals);
    return encodeSqrtRatioX96(
        Math.floor(adjustedPrice * 1e18),
        1e18
    );
}

// Example: USDT (6 decimals) / WVC (18 decimals)
// Price: 1 WVC = 0.5 USDT
// token0 = USDT, token1 = WVC (sorted by address)
const sqrtPriceX96 = encodePriceForPool(0.5, 6, 18);
```

### Simple Price Encoding

```typescript
function encodePrice(price: number): BigNumber {
    const Q96 = BigNumber.from(2).pow(96);
    const sqrtPrice = Math.sqrt(price);
    return BigNumber.from(Math.floor(sqrtPrice * Number(Q96)));
}

// For 1:1 price
const oneToOne = encodePrice(1);

// For 0.5:1 (WVC/USDT)
const wvcUsdt = encodePrice(0.5);
```

### Initialization happens inside `createPool`

Both `Controller.createPool` and `createStandardPool` take `sqrtPriceX96` and
initialise the pool in the same transaction. `Controller.initialize(pool,
sqrtPriceX96)` exists only for a pool that was somehow created uninitialised;
calling it on an initialised pool reverts `AI`. `pool.initialize` is
`onlyFactoryOwner`, so only the Controller can call it.

## Setting Protocol Fees

Protocol fees determine what portion of swap fees go to the protocol.

### Fee Protocol Values

| Value | Protocol Share | LP Share |
|-------|----------------|----------|
| 4 | 25% | 75% |
| 5 | 20% | 80% |
| 6 | 16.7% | 83.3% |
| 7 | 14.3% | 85.7% |
| 8 | 12.5% | 87.5% |
| 9 | 11.1% | 88.9% |
| 10 | 10% | 90% |
| 0 | 0% (disabled) | 100% |

### Set via Controller

```typescript
async function setProtocolFee(
    controller: Contract,
    poolAddress: string,
    feeProtocol: number
) {
    // Same fee for both tokens
    await controller.setFeeProtocol(poolAddress, feeProtocol, feeProtocol);
}

// Set 20% protocol fee
await setProtocolFee(controller, poolAddress, 5);
```

## Verifying Pool Creation

### Check Pool Exists

```typescript
async function verifyPool(
    factory: Contract,
    tokenA: string,
    tokenB: string,
    fee: number
) {
    const poolAddress = await factory.getPool(tokenA, tokenB, fee);

    if (poolAddress === ethers.constants.AddressZero) {
        console.log('Pool does not exist');
        return null;
    }

    const pool = await ethers.getContractAt('VinuSwapPool', poolAddress);
    const slot0 = await pool.slot0();

    console.log('Pool verified:');
    console.log('  Address:', poolAddress);
    console.log('  Current tick:', slot0.tick);
    console.log('  sqrtPriceX96:', slot0.sqrtPriceX96.toString());

    return pool;
}
```

### Full Verification Script

```typescript
async function verifyAllPools(factory: Contract, pools: Array<{
    tokenA: string,
    tokenB: string,
    fee: number,
    expectedPrice: number
}>) {
    for (const { tokenA, tokenB, fee, expectedPrice } of pools) {
        const poolAddress = await factory.getPool(tokenA, tokenB, fee);

        if (poolAddress === ethers.constants.AddressZero) {
            console.error(`Pool ${tokenA}/${tokenB}/${fee} not found!`);
            continue;
        }

        const pool = await ethers.getContractAt('VinuSwapPool', poolAddress);
        const [slot0, liquidity, token0, token1] = await Promise.all([
            pool.slot0(),
            pool.liquidity(),
            pool.token0(),
            pool.token1()
        ]);

        const actualPrice = decodePrice(slot0.sqrtPriceX96);
        const priceDiff = Math.abs(actualPrice - expectedPrice) / expectedPrice * 100;

        console.log(`\nPool: ${tokenA}/${tokenB}`);
        console.log(`  Address: ${poolAddress}`);
        console.log(`  Token0: ${token0}`);
        console.log(`  Token1: ${token1}`);
        console.log(`  Price: ${actualPrice.toFixed(4)} (expected: ${expectedPrice})`);
        console.log(`  Price diff: ${priceDiff.toFixed(2)}%`);
        console.log(`  Liquidity: ${liquidity.toString()}`);
        console.log(`  Status: ${slot0.unlocked ? 'Active' : 'Locked'}`);
    }
}
```

## Adding Initial Liquidity

After creating pools, add initial liquidity:

```typescript
async function addInitialLiquidity(
    positionManager: Contract,
    pool: {
        token0: string,
        token1: string,
        fee: number,
        amount0: BigNumber,
        amount1: BigNumber
    }
) {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Full range for initial liquidity; tick spacing is per pool, not per fee
    const factory = await ethers.getContractAt('VinuSwapFactory', await positionManager.factory());
    const poolAddress = await factory.getPool(pool.token0, pool.token1, pool.fee);
    const tickSpacing = await (await ethers.getContractAt('VinuSwapPool', poolAddress)).tickSpacing();
    const tickLower = Math.ceil(-887272 / tickSpacing) * tickSpacing;
    const tickUpper = Math.floor(887272 / tickSpacing) * tickSpacing;

    // Approve tokens
    const token0 = await ethers.getContractAt('IERC20', pool.token0);
    const token1 = await ethers.getContractAt('IERC20', pool.token1);

    await token0.approve(positionManager.address, pool.amount0);
    await token1.approve(positionManager.address, pool.amount1);

    // Mint position
    const tx = await positionManager.mint({
        token0: pool.token0,
        token1: pool.token1,
        fee: pool.fee,
        tickLower,
        tickUpper,
        amount0Desired: pool.amount0,
        amount1Desired: pool.amount1,
        amount0Min: 0,
        amount1Min: 0,
        recipient: await positionManager.signer.getAddress(),
        deadline
    });

    const receipt = await tx.wait();
    console.log('Initial liquidity added');

    return receipt;
}
```

## Next Steps

- [Configuration](configuration.md) - Configure deployed contracts
- [SDK Examples](../sdk/examples.md) - Start using the SDK
