# Configuration

Post-deployment configuration for VinuSwap contracts.

## Controller Configuration

### Fee Distribution

The payee table (`accounts`, `shares`) is passed to the Controller constructor
and is **fixed for the life of the contract**. There is no `addAccount`,
`updateShare` or `removeAccount`; rotating payees means deploying a new
Controller and moving the factory with `transferFactoryOwnership`. Read the
live table with `accounts(i)` / `shares(account)` / `totalShares()`.

```typescript
async function printFeeDistribution(controller: Contract) {
    const totalShares = await controller.totalShares();
    for (let i = 0; ; i++) {
        let account: string;
        try { account = await controller.accounts(i); } catch { break; }
        const share = await controller.shares(account);
        console.log(`  ${account}: ${share.mul(100).div(totalShares)}%`);
    }
}
```

Live mainnet table: a single payee with 1000/1000 shares (see
[OWNERSHIP.md](../OWNERSHIP.md#live-state-vinuchain-207-block-14680456-2026-08-27)).

## Fee Manager Configuration

### TieredDiscount Settings

`updateInfo` replaces the whole tier table. The live mainnet table is read from
the contract (`token()`, `thresholds(i)`, `discounts(i)`); the values below are
an example only.

```typescript
async function configureTieredDiscount(tieredDiscount: Contract, discountTokenAddress: string) {
    const newThresholds = [
        ethers.utils.parseEther('500'),     // Lower entry
        ethers.utils.parseEther('5000'),
        ethers.utils.parseEther('50000'),
        ethers.utils.parseEther('500000')
    ];

    const newDiscounts = [150, 300, 450, 600]; // 1.5%, 3%, 4.5%, 6%
    await tieredDiscount.updateInfo(discountTokenAddress, newThresholds, newDiscounts);

    console.log('TieredDiscount configured');
}
```

### OverridableFeeManager Settings

```typescript
async function configureOverridableFeeManager(
    overridable: Contract,
    pools: Array<{ pool: string, feeManager: string }>
) {
    for (const { pool, feeManager } of pools) {
        await overridable.setFeeManagerOverride(pool, feeManager);
        console.log(`Pool ${pool} using ${feeManager}`);
    }
}
```

## Pool Configuration

### Protocol Fee Settings

```typescript
async function configureProtocolFees(
    controller: Contract,
    pools: string[],
    feeProtocol: number
) {
    for (const pool of pools) {
        await controller.setFeeProtocol(pool, feeProtocol, feeProtocol);
        console.log(`Pool ${pool}: protocol fee set to 1/${feeProtocol}`);
    }
}
```

### Batch Configuration

```typescript
async function batchConfigurePools(
    controller: Contract,
    poolConfigs: Array<{
        address: string,
        feeProtocol: number
    }>
) {
    for (const config of poolConfigs) {
        await controller.setFeeProtocol(
            config.address,
            config.feeProtocol,
            config.feeProtocol
        );
    }
}

// Example
await batchConfigurePools(controller, [
    { address: '0x...', feeProtocol: 5 },  // 20%
    { address: '0x...', feeProtocol: 4 },  // 25%
    { address: '0x...', feeProtocol: 10 }, // 10%
]);
```

## Oracle Configuration

### Increase Oracle Cardinality

For longer TWAP periods, increase observation capacity:

```typescript
async function increaseOracleCapacity(
    pool: Contract,
    newCardinality: number
) {
    // Current cardinality
    const slot0 = await pool.slot0();
    console.log('Current cardinality:', slot0.observationCardinality);

    // Increase (one-time gas cost)
    await pool.increaseObservationCardinalityNext(newCardinality);
    console.log(`Cardinality increased to ${newCardinality}`);
}

// Increase to support 24-hour TWAP (assuming ~12 sec blocks)
// 24 hours = 7200 observations
await increaseOracleCapacity(pool, 7200);
```

## Ownership Management

### Transfer Ownership

```typescript
// Transfer Factory ownership
async function transferFactoryOwnership(
    factory: Contract,
    newOwner: string
) {
    await factory.setOwner(newOwner);
    console.log(`Factory ownership transferred to ${newOwner}`);
}

// Transfer TieredDiscount ownership
async function transferFeeManagerOwnership(
    tieredDiscount: Contract,
    newOwner: string
) {
    await tieredDiscount.transferOwnership(newOwner);
    console.log(`TieredDiscount ownership transferred to ${newOwner}`);
}
```

### Multi-Sig Setup

The VinuChain deployment uses **single-key custody** (see
[OWNERSHIP.md](../OWNERSHIP.md)); there is no multisig or timelock in front of
the owner roles. If you do move ownership to a multisig, verify the target with
`owner()` afterwards and never call `renounceOwnership`:

```typescript
async function setupMultisig(contracts: {
    factory?: Contract,
    controller?: Contract,
    tieredDiscount?: Contract
}, multisigAddress: string) {
    if (contracts.factory) {
        await contracts.factory.setOwner(multisigAddress);
    }
    if (contracts.controller) {
        await contracts.controller.transferOwnership(multisigAddress);
    }
    if (contracts.tieredDiscount) {
        await contracts.tieredDiscount.transferOwnership(multisigAddress);
    }

    console.log(`Ownership transferred to multisig: ${multisigAddress}`);
}
```

## Configuration Verification

### Verify All Settings

```typescript
async function verifyConfiguration(addresses: {
    factory: string,
    controller: string,
    tieredDiscount: string,
    pools: string[]
}) {
    const factory = await ethers.getContractAt('VinuSwapFactory', addresses.factory);
    const controller = await ethers.getContractAt('Controller', addresses.controller);
    const tieredDiscount = await ethers.getContractAt('TieredDiscount', addresses.tieredDiscount);

    console.log('=== Configuration Verification ===\n');

    // Factory
    console.log('Factory:');
    console.log('  Owner:', await factory.owner());

    // Controller
    console.log('\nController:');
    console.log('  Owner:', await controller.owner());

    // TieredDiscount
    console.log('\nTieredDiscount:');
    console.log('  Discount Token:', await tieredDiscount.token());
    for (let i = 0; i < 4; i++) {
        const threshold = await tieredDiscount.thresholds(i);
        const discount = await tieredDiscount.discounts(i);
        console.log(`  Tier ${i + 1}: ${ethers.utils.formatEther(threshold)} tokens → ${discount / 100}%`);
    }

    // Pools
    console.log('\nPools:');
    for (const poolAddress of addresses.pools) {
        const pool = await ethers.getContractAt('VinuSwapPool', poolAddress);
        const [token0, token1, fee, slot0] = await Promise.all([
            pool.token0(),
            pool.token1(),
            pool.fee(),
            pool.slot0()
        ]);

        console.log(`\n  Pool: ${poolAddress}`);
        console.log(`    Token0: ${token0}`);
        console.log(`    Token1: ${token1}`);
        console.log(`    Fee: ${fee}`);
        console.log(`    Protocol fee: 1/${slot0.feeProtocol & 0xf} and 1/${slot0.feeProtocol >> 4}`);
    }
}
```

## Configuration Checklist

### Pre-Launch

- [ ] Factory ownership transferred to Controller
- [ ] Controller constructor accounts and shares double-checked (immutable after deploy)
- [ ] TieredDiscount thresholds set appropriately
- [ ] All pools created with correct parameters
- [ ] All pools initialized at correct prices
- [ ] Protocol fees set on all pools
- [ ] Initial liquidity added to all pools

### Security Review

- [ ] Custody model decided and recorded in OWNERSHIP.md (VinuChain: single key)
- [ ] Fee managers audited
- [ ] Emergency procedures documented
- [ ] Monitoring set up

### Documentation

- [ ] Contract addresses documented
- [ ] Pool configurations recorded
- [ ] Fee structures documented
- [ ] Admin procedures documented
