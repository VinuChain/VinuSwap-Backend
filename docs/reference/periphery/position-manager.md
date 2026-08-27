# NonfungiblePositionManager

The NonfungiblePositionManager wraps VinuSwap liquidity positions as ERC721 NFTs for easier management.

**Source:** `contracts/periphery/NonfungiblePositionManager.sol`

## Overview

The position manager:
- Mints ERC721 tokens representing liquidity positions
- Tracks position ownership, fees, and liquidity
- Provides functions to modify positions
- **Supports position locking** (VinuSwap extension)

## Inheritance

```
NonfungiblePositionManager
├── INonfungiblePositionManager
├── Multicall
├── ERC721Permit
├── PeripheryImmutableState
├── LiquidityManagement
├── PeripheryValidation
└── SelfPermit
```

## Position Struct

```solidity
struct Position {
    uint96 nonce;                    // Permit nonce
    address operator;                // Approved operator
    uint80 poolId;                   // Pool identifier
    int24 tickLower;                 // Lower tick boundary
    int24 tickUpper;                 // Upper tick boundary
    uint128 liquidity;               // Liquidity amount
    uint256 feeGrowthInside0LastX128; // Fee snapshot token0
    uint256 feeGrowthInside1LastX128; // Fee snapshot token1
    uint256 lockedUntil;             // Lock timestamp (VinuSwap extension)
    uint128 tokensOwed0;             // Uncollected token0
    uint128 tokensOwed1;             // Uncollected token1
}
```

## Functions

### mint

```solidity
function mint(MintParams calldata params)
    external
    payable
    override
    checkDeadline(params.deadline)
    returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    )
```

Creates a new position and mints an NFT.

**Parameters:**

```solidity
struct MintParams {
    address token0;
    address token1;
    uint24 fee;
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    address recipient;
    uint256 deadline;
}
```

| Field | Description |
|-------|-------------|
| `token0` | First token address (must be < token1) |
| `token1` | Second token address |
| `fee` | Pool fee tier |
| `tickLower` | Lower tick boundary |
| `tickUpper` | Upper tick boundary |
| `amount0Desired` | Desired token0 amount |
| `amount1Desired` | Desired token1 amount |
| `amount0Min` | Minimum token0 (slippage protection) |
| `amount1Min` | Minimum token1 (slippage protection) |
| `recipient` | NFT recipient |
| `deadline` | Transaction deadline |

**Returns:**

| Name | Type | Description |
|------|------|-------------|
| `tokenId` | `uint256` | ID of minted NFT |
| `liquidity` | `uint128` | Liquidity added |
| `amount0` | `uint256` | Token0 used |
| `amount1` | `uint256` | Token1 used |

**Example:**

```javascript
const params = {
    token0: USDT,           // Must be sorted
    token1: WVC,
    fee: 3000,
    tickLower: -60000,      // Must be divisible by tickSpacing
    tickUpper: 60000,
    amount0Desired: ethers.utils.parseUnits('1000', 6),
    amount1Desired: ethers.utils.parseEther('0.5'),
    amount0Min: 0,
    amount1Min: 0,
    recipient: userAddress,
    deadline: Math.floor(Date.now() / 1000) + 1800
};

const { tokenId, liquidity, amount0, amount1 } = await positionManager.mint(params);
```

---

### increaseLiquidity

```solidity
function increaseLiquidity(IncreaseLiquidityParams calldata params)
    external
    payable
    override
    checkDeadline(params.deadline)
    returns (
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    )
```

Adds liquidity to an existing position.

**Parameters:**

```solidity
struct IncreaseLiquidityParams {
    uint256 tokenId;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}
```

**Note:** Can be called even on locked positions.

---

### decreaseLiquidity

```solidity
function decreaseLiquidity(DecreaseLiquidityParams calldata params)
    external
    payable
    override
    checkDeadline(params.deadline)
    returns (uint256 amount0, uint256 amount1)
```

Removes liquidity from a position.

**Parameters:**

```solidity
struct DecreaseLiquidityParams {
    uint256 tokenId;
    uint128 liquidity;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}
```

**Requirements:**
- Caller must be owner or approved
- Position must NOT be locked (`block.timestamp >= lockedUntil`)

**Returns:**

| Name | Type | Description |
|------|------|-------------|
| `amount0` | `uint256` | Token0 amount withdrawn |
| `amount1` | `uint256` | Token1 amount withdrawn |

**Note:** Tokens are not transferred automatically. Call `collect()` to receive tokens.

---

### collect

```solidity
function collect(CollectParams calldata params)
    external
    payable
    override
    returns (uint256 amount0, uint256 amount1)
```

Collects tokens owed from a position (from decreaseLiquidity and accumulated fees).

**Parameters:**

```solidity
struct CollectParams {
    uint256 tokenId;
    address recipient;
    uint128 amount0Max;
    uint128 amount1Max;
}
```

| Field | Description |
|-------|-------------|
| `tokenId` | Position NFT ID |
| `recipient` | Token recipient |
| `amount0Max` | Maximum token0 to collect |
| `amount1Max` | Maximum token1 to collect |

**Note:** Can be called on locked positions (fee collection is always allowed).

**Example:**

```javascript
// Collect all owed tokens
const params = {
    tokenId: positionId,
    recipient: userAddress,
    amount0Max: ethers.constants.MaxUint128,
    amount1Max: ethers.constants.MaxUint128
};

const { amount0, amount1 } = await positionManager.collect(params);
```

---

### burn

```solidity
function burn(uint256 tokenId) external payable override
```

Burns a position NFT.

**Requirements:**
- Caller must be owner or approved
- Position liquidity must be 0
- All tokens must be collected (tokensOwed0 = tokensOwed1 = 0)

---

### lock

```solidity
function lock(
    uint256 tokenId,
    uint256 lockedUntil,
    uint256 deadline
) external checkDeadline(deadline)
```

**VinuSwap Extension**

Locks a position until a specified timestamp.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `tokenId` | `uint256` | Position NFT ID |
| `lockedUntil` | `uint256` | Unix timestamp until which position is locked |
| `deadline` | `uint256` | Transaction deadline |

**Requirements:**
- Caller must be owner or approved (an approved operator can extend the lock)
- `lockedUntil` must be strictly greater than both `block.timestamp` AND the current `position.lockedUntil`; there is no upper bound and no unlock

**Effects:**
- Position cannot call `decreaseLiquidity()` until `block.timestamp >= lockedUntil` (reverts `'Locked'`)
- `burn()` is **not** lock-checked: it succeeds whenever liquidity and `tokensOwed` are both zero (a locked position with liquidity cannot reach that state, so it is blocked indirectly)
- Position CAN still call `collect()` and `increaseLiquidity()`, and the NFT can still be transferred (the lock travels with it)

**Events Emitted:**
- `Lock(tokenId, lockedUntil)`

**Example:**

```javascript
// Lock position for 30 days
const lockUntil = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
const deadline = Math.floor(Date.now() / 1000) + 1800;

await positionManager.lock(tokenId, lockUntil, deadline);
```

---

### positions

```solidity
function positions(uint256 tokenId)
    external
    view
    override
    returns (
        uint96 nonce,
        address operator,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint256 lockedUntil
    )
```

Returns position data for a given NFT ID.

**Note:** Returns `lockedUntil` instead of `tokensOwed`. Use `tokensOwed(tokenId)` to get uncollected token amounts.

---

### tokensOwed

```solidity
function tokensOwed(uint256 tokenId)
    external
    view
    returns (
        uint128 tokensOwed0,
        uint128 tokensOwed1
    )
```

Returns uncollected tokens for a position.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `tokenId` | `uint256` | Position NFT ID |

**Returns:**

| Name | Type | Description |
|------|------|-------------|
| `tokensOwed0` | `uint128` | Uncollected token0 |
| `tokensOwed1` | `uint128` | Uncollected token1 |

---

### quoteTokensOwed

```solidity
function quoteTokensOwed(uint256 tokenId)
    external
    returns (
        uint128 tokensOwed0,
        uint128 tokensOwed1
    )
```

Returns what `tokensOwed` **would** be after poking the pool: it calls
`pool.burn(tickLower, tickUpper, 0)` to settle fee growth and then recomputes
the owed amounts (stored `tokensOwed` plus fees accrued since the last
modification).

- **Non-view.** It mutates pool state in a real transaction; only ever use it
  through `eth_call` (`callStatic` / `staticCall`). It is unauthenticated and
  not declared in `INonfungiblePositionManager`; use the concrete ABI.
- **Reverts `'NP'`** when the position manager's aggregate pool position for
  that tick range has zero liquidity (e.g. after a full `decreaseLiquidity`
  before `collect`), because the zero-amount burn requires existing liquidity.
  Fall back to `tokensOwed(tokenId)` in that case.

## Events

### IncreaseLiquidity

```solidity
event IncreaseLiquidity(
    uint256 indexed tokenId,
    uint128 liquidity,
    uint256 amount0,
    uint256 amount1
);
```

### DecreaseLiquidity

```solidity
event DecreaseLiquidity(
    uint256 indexed tokenId,
    uint128 liquidity,
    uint256 amount0,
    uint256 amount1
);
```

### Collect

```solidity
event Collect(
    uint256 indexed tokenId,
    address recipient,
    uint256 amount0,
    uint256 amount1
);
```

### Lock

```solidity
event Lock(
    uint256 tokenId,
    uint256 lockedUntil
);
```

**VinuSwap Extension**

## Error Messages

| Error | Meaning |
|-------|---------|
| `Invalid token ID` | NFT does not exist |
| `Not approved` | Caller lacks permission |
| `Locked` | Position is locked |
| `Not cleared` | Position has uncollected tokens |
| `Price slippage check` | Slippage bounds exceeded |

## Common Patterns

### Create Position with VC

```javascript
// Token0 is WVC
const params = {
    token0: WVC,
    token1: USDT,
    fee: 3000,
    tickLower: -60000,
    tickUpper: 60000,
    amount0Desired: ethers.utils.parseEther('1'),
    amount1Desired: ethers.utils.parseUnits('2000', 6),
    amount0Min: 0,
    amount1Min: 0,
    recipient: userAddress,
    deadline: deadline
};

// Send VC with transaction
await positionManager.mint(params, { value: params.amount0Desired });
```

### Remove All Liquidity

```javascript
// Get current position
const position = await positionManager.positions(tokenId);

// Decrease full liquidity
await positionManager.decreaseLiquidity({
    tokenId,
    liquidity: position.liquidity,
    amount0Min: 0,
    amount1Min: 0,
    deadline
});

// Collect tokens
await positionManager.collect({
    tokenId,
    recipient: userAddress,
    amount0Max: ethers.constants.MaxUint128,
    amount1Max: ethers.constants.MaxUint128
});

// Burn NFT (if unlocked)
await positionManager.burn(tokenId);
```

### Lock and Provide Liquidity

```javascript
// Mint position
const { tokenId } = await positionManager.mint(mintParams);

// Lock for 6 months
const sixMonths = 6 * 30 * 24 * 60 * 60;
const lockUntil = Math.floor(Date.now() / 1000) + sixMonths;

await positionManager.lock(tokenId, lockUntil, deadline);
```

## Interface

```solidity
interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function positions(uint256 tokenId) external view returns (...);
    function mint(MintParams calldata params) external payable returns (...);
    function increaseLiquidity(IncreaseLiquidityParams calldata params) external payable returns (...);
    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (...);
    function collect(CollectParams calldata params) external payable returns (...);
    function burn(uint256 tokenId) external payable;
    function lock(uint256 tokenId, uint256 lockedUntil, uint256 deadline) external;
}
```

## Related

- [Providing Liquidity Guide](../../guides/providing-liquidity.md)
- [Position Locking Guide](../../guides/position-locking.md)
- [VinuSwapPool](../core/pool.md)
