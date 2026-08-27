# IFeeManager Interface

The IFeeManager interface defines the contract for dynamic fee computation in VinuSwap.

**Source:** `contracts/core/interfaces/IFeeManager.sol`

## Interface

```solidity
interface IFeeManager {
    /// @notice Computes the effective fee for a swap
    /// @param fee The base fee in hundredths of a bip
    /// @return The computed fee in hundredths of a bip
    function computeFee(uint24 fee) external returns (uint24);
}
```

## Purpose

Every VinuSwap pool is deployed with a `feeManager` address. During swaps, the pool calls:

```solidity
uint24 effectiveFee = IFeeManager(feeManager).computeFee(fee);
```

This allows:
- Dynamic fee discounts based on user attributes
- Per-pool fee customization
- Time-based or volume-based fee adjustments
- Integration with external systems

## Parameters

### fee

| Type | Description |
|------|-------------|
| `uint24` | Base fee in hundredths of a basis point |

**Fee Encoding:**

```
1 bip = 0.01% = 100 fee units
1% = 100 bips = 10,000 fee units
0.3% = 30 bips = 3,000 fee units
```

## Return Value

| Type | Description |
|------|-------------|
| `uint24` | Computed fee in hundredths of a basis point |

**Requirements:**
- **Must be ≤ the input `fee`.** The pool enforces `require(actualFee <= fee,
  'IFV')` on every swap step; a manager that returns more halts all swaps on
  the pool. Surcharges are impossible, only discounts.
- May be 0 (100% discount); the pool accepts it and LPs earn nothing.
- A revert inside `computeFee` reverts the swap. `mint`/`burn`/`collect` never
  call the manager, so LP withdrawals are unaffected.

## Implementations

### NoDiscount

Returns the fee unchanged:

```solidity
contract NoDiscount is IFeeManager {
    function computeFee(uint24 fee) external pure returns (uint24) {
        return fee;
    }
}
```

### TieredDiscount

Balance-based discounts:

```solidity
contract TieredDiscount is IFeeManager {
    function computeFee(uint24 fee) external view returns (uint24) {
        uint256 balance = IERC20(token).balanceOf(tx.origin);
        uint16 discount = getDiscount(balance);
        return uint24(uint256(fee) * (10000 - discount) / 10000);
    }
}
```

### OverridableFeeManager

Routes to per-pool managers:

```solidity
contract OverridableFeeManager is IFeeManager {
    function computeFee(uint24 fee) external override nonReentrant returns (uint24) {
        address manager = feeManagerOverride[msg.sender]; // msg.sender is the pool
        if (manager == address(0)) {
            manager = defaultFeeManager;
        }
        return IFeeManager(manager).computeFee(fee);
    }
}
```

## Creating Custom Fee Managers

### Basic Template

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import '../interfaces/IFeeManager.sol';

contract CustomFeeManager is IFeeManager {
    function computeFee(uint24 fee) external override returns (uint24) {
        // Your logic here
        return fee;
    }
}
```

### Example: Time-Based Fees

Only discounts are legal. The multiplier must never exceed 10000 (100%): the
version below with `peakMultiplier = 12000` would make every peak-hour swap
revert `'IFV'`.

```solidity
contract TimeBasedFeeManager is IFeeManager {
    uint256 public peakStart = 9 hours;   // 9 AM UTC
    uint256 public peakEnd = 17 hours;    // 5 PM UTC
    uint16 public peakMultiplier = 10000; // 100% during peak (no discount)
    uint16 public offPeakMultiplier = 8000; // 80% off-peak (20% discount)

    function computeFee(uint24 fee) external view override returns (uint24) {
        uint256 timeOfDay = block.timestamp % 1 days;

        uint16 multiplier;
        if (timeOfDay >= peakStart && timeOfDay <= peakEnd) {
            multiplier = peakMultiplier;
        } else {
            multiplier = offPeakMultiplier;
        }

        return uint24(uint256(fee) * multiplier / 10000);
    }
}
```

### Example: Holder-Based Tiers

```solidity
contract NFTHolderDiscount is IFeeManager {
    IERC721 public nftCollection;
    uint16 public holderDiscount = 500; // 5% discount

    constructor(address _nft) {
        nftCollection = IERC721(_nft);
    }

    function computeFee(uint24 fee) external view override returns (uint24) {
        if (nftCollection.balanceOf(tx.origin) > 0) {
            return uint24(uint256(fee) * (10000 - holderDiscount) / 10000);
        }
        return fee;
    }
}
```

### Example: Volume-Based Fees

```solidity
contract VolumeBasedFeeManager is IFeeManager {
    mapping(address => uint256) public userVolume;
    uint256[] public volumeThresholds = [1000e18, 10000e18, 100000e18];
    uint16[] public discounts = [100, 200, 300]; // 1%, 2%, 3%

    function computeFee(uint24 fee) external view override returns (uint24) {
        uint256 volume = userVolume[tx.origin];
        uint16 discount = 0;

        for (uint i = volumeThresholds.length; i > 0; i--) {
            if (volume >= volumeThresholds[i-1]) {
                discount = discounts[i-1];
                break;
            }
        }

        return uint24(uint256(fee) * (10000 - discount) / 10000);
    }

    // Called externally to update volume
    function recordVolume(address user, uint256 amount) external {
        userVolume[user] += amount;
    }
}
```

## Integration Points

### Pool Integration

The pool calls the fee manager during swap execution:

```solidity
// In VinuSwapPool.swap()
uint24 effectiveFee = IFeeManager(feeManager).computeFee(fee);

// effectiveFee is used for:
// 1. Fee amount calculation
// 2. Fee growth accumulation
// 3. Protocol fee calculation
```

### Context Available

Inside `computeFee()`, you have access to:

| Context | Description |
|---------|-------------|
| `msg.sender` | The pool calling the function |
| `tx.origin` | The original transaction sender (user) |
| `block.timestamp` | Current block timestamp |
| `block.number` | Current block number |

**Warning:** Using `tx.origin` has security implications. Ensure your logic accounts for contracts calling contracts.

## Gas Considerations

Fee managers are called on every swap:

| Complexity | Approximate Gas |
|------------|-----------------|
| Passthrough (NoDiscount) | ~200 |
| Single storage read | ~2,600 |
| Balance check | ~2,600 |
| Multiple checks | ~5,000-10,000 |

Keep fee managers simple to minimize swap gas costs.

## Security Considerations

### Reentrancy

Fee managers should not make external calls that could enable reentrancy:

```solidity
// BAD - potential reentrancy
function computeFee(uint24 fee) external override returns (uint24) {
    someContract.callback(); // Don't do this
    return fee;
}

// GOOD - view function, no state changes
function computeFee(uint24 fee) external view override returns (uint24) {
    return fee;
}
```

### DOS Prevention

Fee managers should not revert unexpectedly:

```solidity
// BAD - can block all swaps
function computeFee(uint24 fee) external override returns (uint24) {
    require(someCondition, "Blocked"); // Don't do this
    return fee;
}

// GOOD - graceful fallback
function computeFee(uint24 fee) external view override returns (uint24) {
    if (!someCondition) {
        return fee; // Return base fee as fallback
    }
    return discountedFee;
}
```

### Access Control

For updateable fee managers, implement proper access control:

```solidity
contract SecureFeeManager is IFeeManager, Ownable {
    uint16 public discount;

    function setDiscount(uint16 _discount) external onlyOwner {
        require(_discount <= 5000, "Max 50% discount");
        discount = _discount;
    }

    function computeFee(uint24 fee) external view override returns (uint24) {
        return uint24(uint256(fee) * (10000 - discount) / 10000);
    }
}
```

## Related

- [TieredDiscount](tiered-discount.md)
- [OverridableFeeManager](overridable-fee-manager.md)
- [Fee Management Overview](overview.md)
