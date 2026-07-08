# PoolAddress Library

Functions for computing deterministic pool addresses.

**Source:** `contracts/periphery/libraries/PoolAddress.sol`

## Overview

Pools are deployed using CREATE2, making their addresses deterministic and computable off-chain.

## Structs

### PoolKey

```solidity
struct PoolKey {
    address token0;
    address token1;
    uint24 fee;
}
```

## Functions

### getPoolKey

```solidity
function getPoolKey(
    address tokenA,
    address tokenB,
    uint24 fee
) internal pure returns (PoolKey memory)
```

Returns the PoolKey with tokens sorted (token0 < token1).

### computeAddress

```solidity
function computeAddress(
    address factory,
    PoolKey memory key
) internal pure returns (address pool)
```

Computes the pool address for the given factory and pool key.

**Note:** Requires the correct `POOL_INIT_CODE_HASH` constant.

## Deployment Note

`POOL_INIT_CODE_HASH` is compiled into periphery contracts that compute pool
addresses, including routers, quoters, position managers, and descriptors.
Updating the source constant affects future periphery deployments and source
provenance only. Existing deployed contracts keep the hash they were compiled
with until those periphery contracts are redeployed.

Do not update deployed-address documentation or registry addresses for this
hash alone. Update those records only when a new periphery deployment is
actually made.

## JavaScript Implementation

```javascript
const { ethers } = require('ethers');

// Get this from PoolInitHelper contract
const POOL_INIT_CODE_HASH = '0xabbbd0d15b71abfbaad4b7a124f1070d10b298946137a0f9178c1a8d09b9ea3f'; // PoolAddress.sol:6

function computePoolAddress(factory, tokenA, tokenB, fee) {
    // Sort tokens
    const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];

    // Compute salt
    const salt = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint24'],
            [token0, token1, fee]
        )
    );

    // Compute CREATE2 address
    return ethers.utils.getCreate2Address(
        factory,
        salt,
        POOL_INIT_CODE_HASH
    );
}
```

## Getting Init Code Hash

Deploy the PoolInitHelper and call it:

```javascript
const poolInitHelper = await ethers.getContractAt(
    'PoolInitHelper',
    POOL_INIT_HELPER_ADDRESS
);

const hash = await poolInitHelper.POOL_INIT_CODE_HASH();
console.log('Init code hash:', hash);
```

## Usage Example

```javascript
// Compute WVC/USDT pool address
const poolAddress = computePoolAddress(
    FACTORY_ADDRESS,
    WVC,
    USDT,
    3000  // 0.3% fee
);

// Verify
const factoryContract = new ethers.Contract(FACTORY_ADDRESS, factoryABI, provider);
const actualAddress = await factoryContract.getPool(WVC, USDT, 3000);

console.log('Computed:', poolAddress);
console.log('Actual:', actualAddress);
console.log('Match:', poolAddress.toLowerCase() === actualAddress.toLowerCase());
```

## Related

- [VinuSwapFactory](../core/factory.md)
- [VinuSwapPoolDeployer](../core/deployer.md)
