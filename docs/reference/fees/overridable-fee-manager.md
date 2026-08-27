# OverridableFeeManager

The OverridableFeeManager routes fee computation to different managers based on the calling pool.

**Source:** `contracts/periphery/OverridableFeeManager.sol`

## Overview

OverridableFeeManager allows:
- Per-pool fee manager customization
- Default fee manager for pools without overrides
- Runtime configuration changes

## State Variables

### defaultFeeManager

```solidity
address public defaultFeeManager;
```

The fee manager used when no override is set for a pool.

### feeManagerOverride

```solidity
mapping(address => address) public feeManagerOverride;
```

Pool-specific fee manager overrides.

## Constructor

```solidity
constructor(address _defaultFeeManager)
```

| Parameter | Description |
|-----------|-------------|
| `_defaultFeeManager` | Default fee manager for pools without overrides |

**Example:**

```solidity
OverridableFeeManager manager = new OverridableFeeManager(
    tieredDiscount.address  // Default to tiered discounts
);
```

## Functions

### computeFee

```solidity
function computeFee(uint24 fee) external override nonReentrant returns (uint24)
```

Routes fee computation to the appropriate manager.

**Modifiers:** `nonReentrant` - Prevents reentrancy attacks via malicious fee managers

**Logic:**

```solidity
function computeFee(uint24 fee) external override nonReentrant returns (uint24) {
    if (feeManagerOverride[msg.sender] != address(0)) {
        return IFeeManager(feeManagerOverride[msg.sender]).computeFee(fee);
    }
    return IFeeManager(defaultFeeManager).computeFee(fee);
}
```

**Flow:**

```
Pool calls computeFee(fee)
    │
    ▼
Override exists for pool?
    │
    ├─ YES → Use override manager
    │
    └─ NO → Use default manager
    │
    ▼
Return computed fee
```

---

### setFeeManagerOverride

```solidity
function setFeeManagerOverride(address pool, address newFeeManager) external onlyOwner
```

Sets a fee manager override for a specific pool.

**Access Control:** Owner only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `pool` | `address` | Pool address to override |
| `newFeeManager` | `address` | Fee manager for this pool (address(0) to remove override) |

**Example:**

```javascript
// Set override for stable pool (no discounts)
await overridable.setFeeManagerOverride(stablePool.address, noDiscount.address);

// Remove override (revert to default)
await overridable.setFeeManagerOverride(stablePool.address, ethers.constants.AddressZero);
```

---

### setDefaultFeeManager

```solidity
function setDefaultFeeManager(address _defaultFeeManager) external onlyOwner
```

Updates the default fee manager.

**Access Control:** Owner only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `_defaultFeeManager` | `address` | New default fee manager |

## Usage Patterns

### Different Managers for Different Pool Types

```javascript
// Deploy fee managers
const tieredDiscount = await TieredDiscount.deploy(...);
const noDiscount = await NoDiscount.deploy();
const volumeDiscount = await VolumeDiscount.deploy(...);

// Deploy OverridableFeeManager with tiered as default
const overridable = await OverridableFeeManager.deploy(tieredDiscount.address);

// Create pools with the overridable manager. The factory is owned by the
// Controller, so create through it (owner-only; initialises inline). Read the
// pool address from the PoolCreated event.
await controller.createPool(factory.address, WVC, USDT, 3000, 60, overridable.address, sqrtPriceX96);
const volatilePool = await factory.getPool(WVC, USDT, 3000);

await controller.createPool(factory.address, USDT, TOKEN_C, 100, 1, overridable.address, sqrtPriceX96);
const stablePool = await factory.getPool(USDT, TOKEN_C, 100);

await controller.createPool(factory.address, WVC, TOKEN_D, 500, 10, overridable.address, sqrtPriceX96);
const whalePool = await factory.getPool(WVC, TOKEN_D, 500);

// Configure overrides
await overridable.setFeeManagerOverride(stablePool, noDiscount.address);  // No discount for stables
await overridable.setFeeManagerOverride(whalePool, volumeDiscount.address);  // Volume-based for whales

// Result:
// - volatilePool → tieredDiscount (default)
// - stablePool → noDiscount
// - whalePool → volumeDiscount
```

### Gradual Rollout

```javascript
// Start with no discounts everywhere
const overridable = await OverridableFeeManager.deploy(noDiscount.address);

// ... create pools ...

// Later, enable discounts for specific pools
await overridable.setFeeManagerOverride(popularPool, tieredDiscount.address);

// Eventually, make discounts the default
await overridable.setDefaultFeeManager(tieredDiscount.address);
```

### Emergency Disable

```javascript
// If TieredDiscount has a bug, quickly disable
await overridable.setDefaultFeeManager(noDiscount.address);

// Or disable for specific pool
await overridable.setFeeManagerOverride(affectedPool, noDiscount.address);
```

## Configuration Examples

### Stable Pairs No Discount

```
Default: TieredDiscount
Overrides:
  - USDT/STABLE_A → NoDiscount
  - USDT/STABLE_B → NoDiscount
```

### Premium Pools

```
Default: NoDiscount
Overrides:
  - WVC/USDT (main) → TieredDiscount
  - TOKEN_A/WVC (main) → TieredDiscount
```

### Test vs Production

```
Default: NoDiscount (conservative)
Overrides:
  - TestPool → TieredDiscount (testing new logic)
```

## Querying Configuration

```javascript
// Check default manager
const defaultManager = await overridable.defaultFeeManager();
console.log('Default:', defaultManager);

// Check specific pool override
const poolOverride = await overridable.feeManagerOverride(poolAddress);
if (poolOverride === ethers.constants.AddressZero) {
    console.log('Pool uses default manager');
} else {
    console.log('Pool override:', poolOverride);
}

// Determine actual manager for a pool
async function getPoolFeeManager(pool) {
    const override = await overridable.feeManagerOverride(pool);
    return override === ethers.constants.AddressZero
        ? await overridable.defaultFeeManager()
        : override;
}
```

## Gas Considerations

OverridableFeeManager adds one extra external call:

```
Without Override:
  Pool → OverridableFeeManager → DefaultManager.computeFee()

With Override:
  Pool → OverridableFeeManager → OverrideManager.computeFee()
```

**Approximate Additional Gas:** ~2,600 (SLOAD for mapping lookup)

## Security Considerations

### Reentrancy Protection

The contract inherits from `ReentrancyGuard` and uses the `nonReentrant` modifier on `computeFee()` to prevent reentrancy attacks via malicious fee managers.

### Manager Validation

The contract doesn't validate that override addresses implement IFeeManager:

```solidity
// Owner should verify before setting
require(
    IFeeManager(feeManager).computeFee(1000) > 0,
    "Invalid fee manager"
);
await overridable.setFeeManagerOverride(pool, feeManager);
```

### Access Control

Only owner can modify configuration:
- Consider using multisig
- Add timelock for production deployments
- Log all configuration changes

### Default Manager Trust

All pools without overrides use the default:
- Ensure default manager is well-tested
- Be cautious changing default on live systems

## Inheritance

```solidity
contract OverridableFeeManager is IFeeManager, Ownable, ReentrancyGuard
```

The contract inherits:
- `IFeeManager` - Fee computation interface
- `Ownable` - Access control for configuration
- `ReentrancyGuard` - Reentrancy protection

## Related

- [IFeeManager Interface](ifee-manager.md)
- [TieredDiscount](tiered-discount.md)
- [Controller](controller.md)
