# Interfaces Overview

VinuSwap defines numerous interfaces for contract interaction.

## Core Interfaces

| Interface | Purpose |
|-----------|---------|
| `IVinuSwapFactory` | Factory contract interface |
| `IVinuSwapPool` | Composite pool interface |
| `IVinuSwapPoolActions` | Pool action functions |
| `IVinuSwapPoolEvents` | Pool events |
| `IUniswapV3PoolDerivedState` | Pool computed state |
| `IUniswapV3PoolImmutables` | Pool immutable values |
| `IUniswapV3PoolOwnerActions` | Owner-only functions |
| `IUniswapV3PoolState` | Pool state variables |
| `IVinuSwapExtraPoolOwnerActions` | Initialize function |
| `IVinuSwapPoolDeployer` | Deployer interface |
| `IFeeManager` | Dynamic fee computation |

## Periphery Interfaces

| Interface | Purpose |
|-----------|---------|
| `ISwapRouter` | Swap execution |
| `INonfungiblePositionManager` | Position NFT management |
| `INonfungibleTokenPositionDescriptor` | NFT metadata |
| `IQuoter` | V1-compatible swap quoting (vendored; the deployed quoter does **not** implement it) |
| `IQuoterV2` | Swap quoting — the interface `VinuSwapQuoter` implements |
| `IVinuSwapQuoter` | Orphan single-hop interface: not implemented by any contract; do not code against it |
| `IPeripheryPayments` | Token payments |
| `IPeripheryPaymentsWithFee` | Payments with fee |
| `IPeripheryImmutableState` | Immutable state |
| `IMulticall` | Batch calls |
| `ISelfPermit` | ERC20 permit |
| `IERC721Permit` | NFT permit |

Uniswap's `PairFlash` example and `IUniswapV3FlashCallback` are not usable
here: VinuSwap pools have no `flash()`.

## Callback Interfaces

**Note:** VinuSwap uses Uniswap V3 callback interface names for compatibility.

| Interface | Purpose |
|-----------|---------|
| `IUniswapV3SwapCallback` | Swap callback |
| `IUniswapV3MintCallback` | Mint callback |

## Key Interface Details

### IVinuSwapFactory

```solidity
interface IVinuSwapFactory {
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        int24 tickSpacing,
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

### IVinuSwapPoolActions

```solidity
interface IVinuSwapPoolActions {
    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1);

    function burn(
        int24 tickLower,
        int24 tickUpper,
        uint128 amount
    ) external returns (uint256 amount0, uint256 amount1);

    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    function increaseObservationCardinalityNext(
        uint16 observationCardinalityNext
    ) external;
}
```

### ISwapRouter

```solidity
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params)
        external payable returns (uint256 amountOut);

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external payable returns (uint256 amountIn);

    struct ExactOutputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactOutput(ExactOutputParams calldata params)
        external payable returns (uint256 amountIn);
}
```

### IFeeManager

```solidity
interface IFeeManager {
    function computeFee(uint24 fee) external returns (uint24);
}
```

### Callback Interfaces

VinuSwap uses Uniswap V3's callback interfaces for compatibility:

```solidity
interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}

interface IUniswapV3MintCallback {
    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata data
    ) external;
}
```

## Using Interfaces

### TypeScript

```typescript
import { ISwapRouter } from '../typechain-types';

const router: ISwapRouter = ISwapRouter__factory.connect(
    ROUTER_ADDRESS,
    signer
);

await router.exactInputSingle({
    tokenIn: WVC,
    tokenOut: USDT,
    fee: 3000,
    recipient: userAddress,
    deadline: deadline,
    amountIn: amount,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0
});
```

### Solidity

```solidity
import './interfaces/IVinuSwapPool.sol';

contract MyContract {
    function getPoolPrice(address pool) external view returns (uint160) {
        (uint160 sqrtPriceX96, , , , , , ) = IVinuSwapPool(pool).slot0();
        return sqrtPriceX96;
    }
}
```

## Related

- [Core Contracts](../core/overview.md)
- [Periphery Contracts](../periphery/overview.md)
