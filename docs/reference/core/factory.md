# VinuSwapFactory

The VinuSwapFactory contract deploys VinuSwap pools and serves as the canonical registry for all pools.

**Source:** `contracts/core/VinuSwapFactory.sol`

## Overview

The factory is responsible for:
- Deploying new pools with deterministic addresses
- Maintaining the pool registry
- Managing ownership and access control

## State Variables

### owner

```solidity
address public override owner;
```

The address with administrative privileges. Only the owner can:
- Create new pools
- Transfer ownership

### getPool

```solidity
mapping(address => mapping(address => mapping(uint24 => address))) public override getPool;
```

Returns the pool address for a given token pair and fee tier.

**Note:** The mapping works regardless of token order - `getPool[A][B][fee]` returns the same address as `getPool[B][A][fee]`.

## Functions

### createPool

```solidity
function createPool(
    address tokenA,
    address tokenB,
    uint24 fee,
    int24 tickSpacing,
    address feeManager
) external override returns (address pool)
```

Deploys a new pool for the given token pair.

**Access Control:** Only callable by `owner`

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `tokenA` | `address` | One of the tokens in the pair |
| `tokenB` | `address` | The other token in the pair |
| `fee` | `uint24` | Fee in hundredths of a bip (e.g., 3000 = 0.3%) |
| `tickSpacing` | `int24` | Minimum tick interval for positions |
| `feeManager` | `address` | Contract for dynamic fee computation |

**Returns:**

| Name | Type | Description |
|------|------|-------------|
| `pool` | `address` | Address of the newly created pool |

**Requirements:**
- `msg.sender == owner`
- `tokenA != tokenB`
- `tokenA != address(0)` and `tokenB != address(0)`
- `fee < 1000000` (< 100%)
- `tickSpacing > 0 && tickSpacing < 16384`
- Pool does not already exist for this pair/fee combination

**Example:**

```solidity
// Create a pool with 0.3% fee and tick spacing of 60
address pool = factory.createPool(
    WVC,            // tokenA
    USDT,           // tokenB
    3000,           // 0.3% fee
    60,             // tick spacing
    tieredDiscount  // fee manager
);
```

### setOwner

```solidity
function setOwner(address _owner) external override
```

Transfers ownership to a new address.

**Access Control:** Only callable by current `owner`

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `_owner` | `address` | New owner address |

**Events Emitted:**
- `OwnerChanged(oldOwner, newOwner)`

## Events

### PoolCreated

```solidity
event PoolCreated(
    address indexed token0,
    address indexed token1,
    uint24 indexed fee,
    int24 tickSpacing,
    address feeManager,
    address pool
);
```

Emitted when a new pool is deployed.

**Note:** `token0` will always be less than `token1` (sorted by address).

### OwnerChanged

```solidity
event OwnerChanged(address indexed oldOwner, address indexed newOwner);
```

Emitted when ownership is transferred.

## Pool Address Computation

Pool addresses are deterministic and can be computed off-chain:

```javascript
const { ethers } = require('ethers');

function computePoolAddress(factory, token0, token1, fee) {
    // Ensure token0 < token1
    if (token0 > token1) {
        [token0, token1] = [token1, token0];
    }

    // Live VinuChain factory 0xd74dEe1C...: 0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e
    // Local HEAD build (PoolInitHelper.getInitCodeHash()): 0xabbbd0d15b71abfbaad4b7a124f1070d10b298946137a0f9178c1a8d09b9ea3f
    // See ../libraries/pool-address.md for the worked example.
    const POOL_INIT_CODE_HASH = '0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e';

    const salt = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint24'],
            [token0, token1, fee]
        )
    );

    return ethers.utils.getCreate2Address(
        factory,
        salt,
        POOL_INIT_CODE_HASH
    );
}
```

## Interface

```solidity
interface IVinuSwapFactory {
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        int24 tickSpacing,
        address feeManager,
        address pool
    );

    function owner() external view returns (address);

    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);

    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee,
        int24 tickSpacing,
        address feeManager
    ) external returns (address pool);

    function setOwner(address _owner) external;
}
```

## Usage Examples

### Creating a Pool

`createPool` is owner-only and on VinuChain the owner is the Controller
(`0x47fF80713b1d66DdA47237AB374F3080E2075528`), so a direct call from an EOA
reverts. Create pools through `Controller.createPool` (owner; initialises
inline) or the permissionless `Controller.createStandardPool` (only fees with a
non-zero default tick spacing: 500/10, 3000/60, 10000/200 live):

```javascript
const controller = new ethers.Contract(controllerAddress, controllerABI, signer);

// Create WVC/USDT pool with 0.05% fee
const tx = await controller.createPool(
    factoryAddress,
    WVC_ADDRESS,
    USDT_ADDRESS,
    500,           // 0.05%
    10,            // tick spacing (free-form)
    feeManager,    // fee manager contract
    sqrtPriceX96   // initial price
);

const receipt = await tx.wait();
const poolCreatedEvent = receipt.events.find(e => e.event === 'PoolCreated');
const poolAddress = poolCreatedEvent.args.pool;
```

### Querying a Pool

```javascript
// Get pool address (order doesn't matter)
const poolAddress = await factory.getPool(
    USDT_ADDRESS,  // Can be in any order
    WVC_ADDRESS,
    500
);

if (poolAddress === ethers.constants.AddressZero) {
    console.log('Pool does not exist');
}
```

### Transferring Ownership

```javascript
// Only current owner can call
await factory.setOwner(newOwnerAddress);
```

## Differences from Uniswap V3

| Aspect | Uniswap V3 | VinuSwap |
|--------|------------|----------|
| Pool Creation | Permissionless | Owner-only |
| Fee Tiers | Fixed mapping to tick spacing | Custom per-pool |
| Fee Manager | Not supported | Required parameter |
| Tick Spacing | Determined by fee tier | Specified at creation |

## Security Considerations

1. **Owner Privilege**: The owner has significant control. Consider using a multisig or timelock.

2. **Fee Manager Trust**: The fee manager contract is called during every swap. Ensure it's a trusted implementation.

3. **Pool Uniqueness**: Each token pair + fee combination can only have one pool.

## Related

- [VinuSwapPool](pool.md)
- [VinuSwapPoolDeployer](deployer.md)
- [Fee Management Overview](../fees/overview.md)
