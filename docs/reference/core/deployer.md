# VinuSwapPoolDeployer

The VinuSwapPoolDeployer contract handles the deterministic deployment of VinuSwap pools.

**Source:** `contracts/core/VinuSwapPoolDeployer.sol`

## Overview

The deployer is responsible for:
- Creating pools with deterministic addresses using CREATE2
- Passing deployment parameters to new pools

## How It Works

The deployer uses a transient storage pattern to pass parameters to newly created pools:

```
1. Factory calls deploy() with parameters
2. Deployer stores parameters in transient storage
3. Deployer creates pool using CREATE2 with salt
4. Pool constructor calls back to deployer.parameters()
5. Pool retrieves its configuration from deployer
```

This pattern avoids passing constructor arguments in the bytecode, enabling deterministic addresses.

## State Variables

### Internal Parameter Storage

```solidity
address internal _factory;
address internal _token0;
address internal _token1;
uint24 internal _fee;
int24 internal _tickSpacing;
address internal _feeManager;
```

Holds deployment parameters set immediately before `new VinuSwapPool()` is called; the pool constructor reads them via `parameters()`.

### parameters

```solidity
function parameters() public view override returns (
    address factory,
    address token0,
    address token1,
    uint24 fee,
    int24 tickSpacing,
    address feeManager
)
```

Returns the current deployment parameters. Called by the pool constructor to retrieve its configuration.

## Functions

### deploy

```solidity
function deploy(
    address factory,
    address token0,
    address token1,
    uint24 fee,
    int24 tickSpacing,
    address feeManager
) internal returns (address pool)
```

Deploys a new VinuSwapPool.

**Access:** Internal (called by VinuSwapFactory)

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `factory` | `address` | Factory address |
| `token0` | `address` | First token (must be < token1) |
| `token1` | `address` | Second token |
| `fee` | `uint24` | Swap fee |
| `tickSpacing` | `int24` | Tick spacing |
| `feeManager` | `address` | Fee manager contract |

**Returns:**

| Name | Type | Description |
|------|------|-------------|
| `pool` | `address` | Deployed pool address |

## Address Computation

Pool addresses are deterministic based on:
- Factory address (deployer)
- Token pair and fee (salt)
- Pool bytecode (init code hash)

### Salt Calculation

```solidity
bytes32 salt = keccak256(abi.encode(token0, token1, fee));
```

### Off-Chain Address Computation

```javascript
const { ethers } = require('ethers');

function computePoolAddress(factory, token0, token1, fee) {
    // Token addresses must be sorted
    if (token0.toLowerCase() > token1.toLowerCase()) {
        [token0, token1] = [token1, token0];
    }

    const POOL_INIT_CODE_HASH = '0x...'; // From PoolInitHelper

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

## PoolInitHelper

The `PoolInitHelper` contract provides the init code hash needed for address computation:

**Source:** `contracts/extra/PoolInitHelper.sol`

```solidity
contract PoolInitHelper {
    bytes32 public constant POOL_INIT_CODE_HASH =
        keccak256(type(VinuSwapPool).creationCode);
}
```

### Getting the Init Code Hash

```javascript
const poolInitHelper = new ethers.Contract(
    POOL_INIT_HELPER_ADDRESS,
    ['function getInitCodeHash() view returns (bytes32)'],
    provider
);

const initCodeHash = await poolInitHelper.getInitCodeHash();
```

## Interface

```solidity
interface IVinuSwapPoolDeployer {
    function parameters()
        external
        view
        returns (
            address factory,
            address token0,
            address token1,
            uint24 fee,
            int24 tickSpacing,
            address feeManager
        );
}
```

## Security Considerations

1. **Inheritance**: The deployer is inherited by the factory, not a standalone contract.

2. **Parameter Storage**: Parameters are stored in internal variables and overwritten on each deployment. Since `deploy()` is internal and only callable by the factory, the parameters cannot be manipulated externally.

3. **Deterministic Addresses**: The CREATE2 pattern ensures pool addresses can be computed without querying the chain.

## Related

- [VinuSwapFactory](factory.md)
- [VinuSwapPool](pool.md)
- [PoolAddress Library](../libraries/pool-address.md)
