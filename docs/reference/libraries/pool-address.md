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

**Note:** Requires the correct `POOL_INIT_CODE_HASH` constant — see the table
below; the wrong one derives an address with no code. The source comment above
the constant points at a runbook `vinuswap-init-code-hash.md`; that file does
not exist in this repository. This page is the reference for the hash, and
`scripts/main_scripts/preflight.ts` (`assertPeripheryInitCodeHash`) is the
enforcement.

## Init code hashes

| Context | Factory | `POOL_INIT_CODE_HASH` |
|---------|---------|-----------------------|
| **VinuChain mainnet (live)** | `0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe` | `0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e` |
| Local HEAD build / tests | Hardhat-deployed factory | `0xabbbd0d15b71abfbaad4b7a124f1070d10b298946137a0f9178c1a8d09b9ea3f` |

The live router, position manager, quoter and descriptor all embed the live
value; `contracts/periphery/libraries/PoolAddress.sol` pins the local value for
the test build. Any periphery deployed against the live factory must be built
with the live hash. Legacy factories (`0x822F…5939`, `0x9070…54C5`) embed
different pool bytecode and match neither value; use their `getPool`.

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

// Live VinuChain factory 0xd74dEe1C...; use 0xabbbd0d1...ea3f only against a local build
const POOL_INIT_CODE_HASH = '0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e';

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

For a **local build**, deploy the PoolInitHelper and call its only getter
(`POOL_INIT_CODE_HASH` in `PoolAddress.sol` is `internal`, not callable):

```javascript
const poolInitHelper = await ethers.getContractAt(
    'PoolInitHelper',
    POOL_INIT_HELPER_ADDRESS
);

const hash = await poolInitHelper.getInitCodeHash();
console.log('Init code hash:', hash);
```

For the **live** factory, use the published value above and confirm it with the
worked example below.

## Usage Example

Worked example on mainnet (WVC/USDT 0.3%):

```
factory = 0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe
token0  = USDT 0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41   (sorts below WVC)
token1  = WVC  0xEd8c5530a0A086a12f57275728128a60DFf04230
salt    = keccak256(abi.encode(token0, token1, 3000))
        = 0xdf1176321db21cf2248ea7802efbd74eca955dc198dceba940fcf7dd0f5665e9
CREATE2(factory, salt, 0xe8b8…596e) = 0x2f50d5E141A5B9F148187008DE4795A4Be407112  ✔ == factory.getPool(WVC, USDT, 3000)
CREATE2(factory, salt, 0xabbb…ea3f) = 0x58DB0b48e365d270876B32DDcB024488F9523115  ✘ (no code)
```

```javascript
// Compute WVC/USDT pool address
const poolAddress = computePoolAddress(
    '0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe',
    WVC,
    USDT,
    3000  // 0.3% fee
);  // -> 0x2f50d5E141A5B9F148187008DE4795A4Be407112

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
