# Fee Management Overview

VinuSwap extends Uniswap V3 with a flexible fee management system that allows dynamic fee computation and multi-account fee distribution.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SWAP EXECUTION                                 │
│                                                                             │
│  User → SwapRouter → VinuSwapPool.swap()                                   │
│                            │                                                │
│                            ▼                                                │
│                   ┌─────────────────┐                                      │
│                   │   feeManager    │ ← IFeeManager.computeFee(fee)        │
│                   └────────┬────────┘                                      │
│                            │                                                │
│           ┌────────────────┼────────────────┐                              │
│           ▼                ▼                ▼                              │
│  ┌─────────────────┐ ┌──────────────┐ ┌───────────────────────┐           │
│  │  TieredDiscount │ │  NoDiscount  │ │ OverridableFeeManager │           │
│  │ Balance-based   │ │  Passthrough │ │    Per-pool routing   │           │
│  │   discounts     │ │              │ │                       │           │
│  └─────────────────┘ └──────────────┘ └───────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           FEE COLLECTION                                    │
│                                                                             │
│  Pool.protocolFees → Controller.collectProtocolFees()                      │
│                            │                                                │
│                            ▼                                                │
│                   ┌─────────────────┐                                      │
│                   │   Controller    │                                      │
│                   │ Fee Distribution│                                      │
│                   └────────┬────────┘                                      │
│                            │                                                │
│           ┌────────────────┼────────────────┐                              │
│           ▼                ▼                ▼                              │
│      ┌─────────┐      ┌─────────┐      ┌─────────┐                        │
│      │Account 1│      │Account 2│      │Account 3│                        │
│      │Share: 1 │      │Share: 2 │      │Share: 2 │                        │
│      └─────────┘      └─────────┘      └─────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### IFeeManager Interface

The core interface for fee computation:

```solidity
interface IFeeManager {
    function computeFee(uint24 fee) external returns (uint24);
}
```

- Called on every swap step
- Can **reduce** the fee dynamically
- Hard invariant enforced by the pool: `actualFee <= fee` (reverts `'IFV'`).
  A manager can never raise the fee above the pool's immutable `fee`; a
  manager that tries halts every swap on that pool.

[Full Reference →](ifee-manager.md)

### TieredDiscount

Balance-based fee discounts. Tiers are contract state; read them live with
`token()`, `thresholds(i)`, `discounts(i)`. Live VinuChain table
(`0x58818859dD0179498c530f549270F40fEB48579E`, token VINU):

```
Balance >= 10T  VINU → 75% fee reduction
Balance >= 5T   VINU → 50% fee reduction
Balance >= 1T   VINU → 25% fee reduction
Balance >= 500B VINU → 10% fee reduction
Balance >= 100B VINU →  5% fee reduction
```

This contract is deployed but **not routed** by the live OverridableFeeManager
(see below).

[Full Reference →](tiered-discount.md)

### OverridableFeeManager

Per-pool fee manager routing:

```
Pool A → override (any IFeeManager)
Pool B → override
Default → defaultFeeManager()
```

Live VinuChain (`0xA15770c5692646667c195446996e1fE9D210374c`): no overrides;
`defaultFeeManager()` = **NoDiscount** `0xb96178F0517A4E2268B85a76ccFeA7E8382Ca1be`,
so every current-factory pool charges its base fee.

[Full Reference →](overridable-fee-manager.md)

### Controller

Protocol fee collection and distribution:

- Collects protocol fees from pools
- Distributes to multiple accounts with configurable shares
- Manages pool creation and initialization

[Full Reference →](controller.md)

## Fee Flow

### 1. Swap Fee Application

```
Swap Amount: 1000 USDT
Pool Fee: 0.3% (3000)
tx.origin balance: 600B VINU (with TieredDiscount routed)

1. Pool calls feeManager.computeFee(3000)
2. TieredDiscount checks tx.origin's VINU balance
   - 600B >= 500B → 10% discount
3. Returns: 3000 * 0.90 = 2700 (0.27%)
4. Effective fee: 2.70 USDT (instead of 3 USDT)

With the live NoDiscount default the pool receives 3000 back unchanged.
```

### 2. Protocol Fee Split

```
Swap Fee Collected: 2.70 USDT
Protocol Fee Setting: 5 (= 1/5 = 20%)   (live current-factory pools: 0 = off)

Protocol portion: 2.70 * 0.20 = 0.54 USDT
LP portion: 2.70 * 0.80 = 2.16 USDT
```

### 3. Fee Distribution

```
Protocol Fees in Controller: 100 USDT
Shares: [Account1: 1, Account2: 2, Account3: 2]
Total Shares: 5

Account1: 100 * (1/5) = 20 USDT
Account2: 100 * (2/5) = 40 USDT
Account3: 100 * (2/5) = 40 USDT
```

## Configuration

### Setting Up Fee Management

1. **Deploy Fee Managers:**

```javascript
// Deploy TieredDiscount
const tieredDiscount = await TieredDiscount.deploy(
    discountToken,      // Token to check balance of
    [1000, 10000, 100000, 1000000],  // Thresholds
    [100, 200, 300, 400]             // Discounts in bps
);

// Deploy OverridableFeeManager
const overridable = await OverridableFeeManager.deploy(
    tieredDiscount.address  // Default manager
);
```

2. **Create Pool with Fee Manager** (through the Controller — the factory's
   owner — which also initialises the pool; a direct `factory.createPool` from
   an EOA reverts):

```javascript
await controller.createPool(
    factory.address,
    tokenA,
    tokenB,
    3000,                 // 0.3% fee
    60,                   // tick spacing (free-form, 1..16383)
    overridable.address,  // fee manager (immutable per pool)
    sqrtPriceX96          // initial price; initialised inline
);
// or, permissionless, using the owner-set defaults for this fee:
await controller.createStandardPool(factory.address, tokenA, tokenB, 3000, sqrtPriceX96);
```

3. **Configure Controller:**

```javascript
const controller = await Controller.deploy(
    [account1, account2, account3],  // Fee recipients
    [1, 2, 2]                        // Shares
);
```

### Setting Protocol Fees

```javascript
// Via Controller (owner only). Accepted per-token values: 0 (off) or 4..10.
await controller.setFeeProtocol(poolAddress, 5, 5);  // 20% protocol fee
// pool.setFeeProtocol is onlyFactoryOwner, i.e. callable only by the Controller.
```

### Collecting Fees

```javascript
// Collect from pool to Controller
await controller.collectProtocolFees(
    poolAddress,
    ethers.constants.MaxUint128,  // Max token0
    ethers.constants.MaxUint128   // Max token1
);

// Each account withdraws their share
const owed0 = await controller.balanceOf(account1.address, token0);
await controller.connect(account1).withdraw(token0, owed0);
const owed1 = await controller.balanceOf(account1.address, token1);
await controller.connect(account1).withdraw(token1, owed1);
```

## Fee Manager Implementations

### NoDiscount

Passthrough implementation - returns fee unchanged:

```solidity
contract NoDiscount is IFeeManager {
    function computeFee(uint24 fee) external pure returns (uint24) {
        return fee;
    }
}
```

### Custom Fee Managers

Create custom logic by implementing IFeeManager. The result must satisfy
`actualFee <= fee`; a surcharge manager is **invalid** — the pool reverts
`'IFV'` and no swap on that pool can succeed while it is routed:

```solidity
// INVALID: returns more than the pool fee during peak hours -> every swap
// reverts 'IFV' in that window.
contract TimeBasedFee is IFeeManager {
    function computeFee(uint24 fee) external view returns (uint24) {
        if (block.timestamp % 86400 >= 32400 &&
            block.timestamp % 86400 <= 61200) {
            return fee * 12 / 10;  // > fee: rejected by the pool
        }
        return fee;
    }
}
```

```solidity
contract VolumeBasedFee is IFeeManager {
    uint256 public dailyVolume;

    function computeFee(uint24 fee) external view returns (uint24) {
        // Lower fees for high volume
        if (dailyVolume > 1_000_000e18) {
            return fee * 8 / 10;  // 20% discount
        }
        return fee;
    }
}
```

## Security Considerations

### Fee Manager Trust

- Fee managers are called on every swap step while the pool is locked (they
  cannot re-enter the pool)
- They **cannot** raise fees: the pool enforces `actualFee <= fee` (`'IFV'`)
- The two real failure modes of a hostile or buggy manager:
  1. `computeFee` reverts (or returns > fee) → **swaps halt** on affected pools;
     `mint`/`burn`/`collect` never consult the manager, so LP funds stay
     withdrawable
  2. returns 0 (100% discount) → trades continue with **zero LP fee revenue**
- Only use audited fee manager implementations

### Protocol Fee Bounds

- Protocol fee is limited: 0 or 4-10 (10-25% of LP fees)
- Cannot be set to capture all fees

### Controller Access

- Only designated accounts can withdraw their shares
- The payee table is fixed in the constructor; there is no add/remove/update
  function. Rotating payees means a new Controller plus
  `transferFactoryOwnership`
- Consider timelock for owner operations (the VinuChain deployment uses
  single-key custody; see [OWNERSHIP.md](../../OWNERSHIP.md))

## Best Practices

1. **Start Simple**: Use NoDiscount initially, add complexity later
2. **Test Thoroughly**: Fee manager bugs affect every swap
3. **Monitor Gas**: Complex fee calculations increase swap costs
4. **Audit Custom Managers**: Critical path for every trade
5. **Use Multisig**: Protect owner functions with multisig/timelock

## Related

- [IFeeManager Interface](ifee-manager.md)
- [TieredDiscount](tiered-discount.md)
- [OverridableFeeManager](overridable-fee-manager.md)
- [Controller](controller.md)
- [Fee Discounts Guide](../../guides/fee-discounts.md)
