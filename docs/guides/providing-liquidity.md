# Providing Liquidity

This guide covers creating and managing liquidity positions on VinuSwap.

## Overview

VinuSwap uses **concentrated liquidity**, where LPs provide liquidity within specific price ranges represented as NFTs.

## Prerequisites

```javascript
const { ethers } = require('ethers');

const POSITION_MANAGER = '0xF699ec0764741f66F81068665eFFAeefA3c6037a';
const WVC = '0xEd8c5530a0A086a12f57275728128a60DFf04230';   // Wrapped VC (native token)
const USDT = '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41';  // USDT on VinuChain

const positionManager = new ethers.Contract(
    POSITION_MANAGER,
    positionManagerABI,
    signer
);
```

## Creating Positions

### Choose Your Price Range

Convert prices to ticks:

```javascript
function priceToTick(price) {
    return Math.floor(Math.log(price) / Math.log(1.0001));
}

function tickToPrice(tick) {
    return Math.pow(1.0001, tick);
}

// Round tick to valid tick spacing
function nearestUsableTick(tick, tickSpacing) {
    return Math.round(tick / tickSpacing) * tickSpacing;
}

// Example: WVC/USDT position from $1,800 to $2,200
const tickSpacing = 60;  // 0.3% fee tier
const tickLower = nearestUsableTick(priceToTick(1800), tickSpacing);
const tickUpper = nearestUsableTick(priceToTick(2200), tickSpacing);
```

### Mint Position

```javascript
async function createPosition(
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    slippagePercent = 0.5
) {
    // Ensure tokens are sorted
    if (token0.toLowerCase() > token1.toLowerCase()) {
        [token0, token1] = [token1, token0];
        [amount0Desired, amount1Desired] = [amount1Desired, amount0Desired];
    }

    // Calculate minimum amounts with slippage
    const slippageBps = slippagePercent * 100;
    const amount0Min = amount0Desired.mul(10000 - slippageBps).div(10000);
    const amount1Min = amount1Desired.mul(10000 - slippageBps).div(10000);

    // Approve tokens
    const token0Contract = new ethers.Contract(token0, erc20ABI, signer);
    const token1Contract = new ethers.Contract(token1, erc20ABI, signer);
    await token0Contract.approve(positionManager.address, amount0Desired);
    await token1Contract.approve(positionManager.address, amount1Desired);

    // Mint params
    const params = {
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient: signer.address,
        deadline: Math.floor(Date.now() / 1000) + 1800
    };

    const tx = await positionManager.mint(params);
    const receipt = await tx.wait();

    // Parse events to get token ID
    const event = receipt.events.find(e => e.event === 'IncreaseLiquidity');
    const tokenId = event.args.tokenId;

    return { receipt, tokenId };
}

// Usage
const { tokenId } = await createPosition(
    USDT,
    WVC,
    3000,  // 0.3% fee
    tickLower,
    tickUpper,
    ethers.utils.parseUnits('2000', 6),  // 2000 USDT
    ethers.utils.parseEther('1')          // 1 WVC
);
```

### Create Position with VC

```javascript
async function createPositionWithVC(
    token,
    fee,
    tickLower,
    tickUpper,
    tokenAmount,
    vcAmount
) {
    // WVC is always either token0 or token1
    const isWVCToken0 = WVC.toLowerCase() < token.toLowerCase();

    const params = {
        token0: isWVCToken0 ? WVC : token,
        token1: isWVCToken0 ? token : WVC,
        fee,
        tickLower,
        tickUpper,
        amount0Desired: isWVCToken0 ? vcAmount : tokenAmount,
        amount1Desired: isWVCToken0 ? tokenAmount : vcAmount,
        amount0Min: 0,
        amount1Min: 0,
        recipient: signer.address,
        deadline: Math.floor(Date.now() / 1000) + 1800
    };

    // Approve token
    const tokenContract = new ethers.Contract(token, erc20ABI, signer);
    await tokenContract.approve(positionManager.address, tokenAmount);

    // Mint with VC value
    const tx = await positionManager.mint(params, { value: vcAmount });
    return await tx.wait();
}
```

## Managing Positions

### View Position Details

```javascript
async function getPosition(tokenId) {
    const position = await positionManager.positions(tokenId);

    return {
        nonce: position.nonce,
        operator: position.operator,
        token0: position.token0,
        token1: position.token1,
        fee: position.fee,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity,
        feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
        feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
        lockedUntil: position.lockedUntil
    };
}
```

VinuSwap's `positions()` returns 11 values ending in `lockedUntil`; there are
**no** `tokensOwed0/1` fields (reading them yields `undefined`). Use the
separate getters:

```javascript
// Stored (already accounted) uncollected amounts — view
const [owed0, owed1] = await positionManager.tokensOwed(tokenId);

// Stored + fees accrued since the last poke — NON-view; eth_call it only.
// Reverts 'NP' when the NFPM's pool position for this range has 0 liquidity
// (e.g. after a full decreaseLiquidity), so fall back to tokensOwed().
const [quoted0, quoted1] = await positionManager.callStatic
    .quoteTokensOwed(tokenId)
    .catch(() => positionManager.tokensOwed(tokenId));
```

### Increase Liquidity

```javascript
async function increaseLiquidity(tokenId, amount0, amount1) {
    const params = {
        tokenId,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: Math.floor(Date.now() / 1000) + 1800
    };

    // Approve additional tokens
    const position = await positionManager.positions(tokenId);
    await approveToken(position.token0, amount0);
    await approveToken(position.token1, amount1);

    const tx = await positionManager.increaseLiquidity(params);
    return await tx.wait();
}
```

### Decrease Liquidity

```javascript
async function decreaseLiquidity(tokenId, liquidityAmount) {
    const params = {
        tokenId,
        liquidity: liquidityAmount,
        amount0Min: 0,  // Add slippage protection
        amount1Min: 0,
        deadline: Math.floor(Date.now() / 1000) + 1800
    };

    const tx = await positionManager.decreaseLiquidity(params);
    return await tx.wait();

    // Note: Tokens are not transferred yet - call collect()
}

// Remove all liquidity
async function removeAllLiquidity(tokenId) {
    const position = await positionManager.positions(tokenId);
    return decreaseLiquidity(tokenId, position.liquidity);
}
```

## Collecting Fees

### Collect Accumulated Fees

```javascript
async function collectFees(tokenId, recipient) {
    const params = {
        tokenId,
        recipient: recipient || signer.address,
        amount0Max: ethers.constants.MaxUint128,
        amount1Max: ethers.constants.MaxUint128
    };

    const tx = await positionManager.collect(params);
    const receipt = await tx.wait();

    // Parse collected amounts from event
    const event = receipt.events.find(e => e.event === 'Collect');

    return {
        amount0: event.args.amount0,
        amount1: event.args.amount1
    };
}
```

### Collect to VC

If your position includes WVC and you want VC:

```javascript
async function collectToVC(tokenId) {
    const position = await positionManager.positions(tokenId);
    const hasWVC = position.token0 === WVC || position.token1 === WVC;

    if (!hasWVC) {
        throw new Error('Position does not include WVC');
    }

    // Collect to router (ADDRESS_ZERO triggers unwrap handling)
    const collectParams = {
        tokenId,
        recipient: ethers.constants.AddressZero,
        amount0Max: ethers.constants.MaxUint128,
        amount1Max: ethers.constants.MaxUint128
    };

    const calls = [
        positionManager.interface.encodeFunctionData('collect', [collectParams]),
        positionManager.interface.encodeFunctionData('unwrapWETH9', [0, signer.address]),
        positionManager.interface.encodeFunctionData('sweepToken', [
            position.token0 === WVC ? position.token1 : position.token0,
            0,
            signer.address
        ])
    ];

    const tx = await positionManager.multicall(calls);
    return await tx.wait();
}
```

## Closing Positions

### Full Withdrawal and Burn

```javascript
async function closePosition(tokenId) {
    const position = await positionManager.positions(tokenId);

    // 1. Decrease all liquidity
    if (position.liquidity.gt(0)) {
        await positionManager.decreaseLiquidity({
            tokenId,
            liquidity: position.liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: Math.floor(Date.now() / 1000) + 1800
        });
    }

    // 2. Collect all tokens
    await positionManager.collect({
        tokenId,
        recipient: signer.address,
        amount0Max: ethers.constants.MaxUint128,
        amount1Max: ethers.constants.MaxUint128
    });

    // 3. Burn the NFT
    await positionManager.burn(tokenId);
}
```

### Using Multicall

```javascript
async function closePositionMulticall(tokenId) {
    const position = await positionManager.positions(tokenId);
    const deadline = Math.floor(Date.now() / 1000) + 1800;

    const calls = [];

    // Decrease liquidity
    if (position.liquidity.gt(0)) {
        calls.push(
            positionManager.interface.encodeFunctionData('decreaseLiquidity', [{
                tokenId,
                liquidity: position.liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline
            }])
        );
    }

    // Collect
    calls.push(
        positionManager.interface.encodeFunctionData('collect', [{
            tokenId,
            recipient: signer.address,
            amount0Max: ethers.constants.MaxUint128,
            amount1Max: ethers.constants.MaxUint128
        }])
    );

    // Burn
    calls.push(
        positionManager.interface.encodeFunctionData('burn', [tokenId])
    );

    const tx = await positionManager.multicall(calls);
    return await tx.wait();
}
```

## Position Value Calculation

### Calculate Token Amounts

```javascript
const { TickMath, Position, Pool } = require('@uniswap/v3-sdk');

function getPositionAmounts(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper
) {
    const sqrtRatioA = TickMath.getSqrtRatioAtTick(tickLower);
    const sqrtRatioB = TickMath.getSqrtRatioAtTick(tickUpper);

    let amount0, amount1;

    if (sqrtPriceX96 <= sqrtRatioA) {
        // Current price below range
        amount0 = Position.getAmount0(sqrtRatioA, sqrtRatioB, liquidity);
        amount1 = BigNumber.from(0);
    } else if (sqrtPriceX96 >= sqrtRatioB) {
        // Current price above range
        amount0 = BigNumber.from(0);
        amount1 = Position.getAmount1(sqrtRatioA, sqrtRatioB, liquidity);
    } else {
        // Current price in range
        amount0 = Position.getAmount0(sqrtPriceX96, sqrtRatioB, liquidity);
        amount1 = Position.getAmount1(sqrtRatioA, sqrtPriceX96, liquidity);
    }

    return { amount0, amount1 };
}
```

### Calculate Uncollected Fees

```javascript
async function getUnclaimedFees(pool, position, tokenId) {
    // quoteTokensOwed pokes the pool (burn 0) and returns stored + accrued fees.
    // It is non-view: always eth_call it. It reverts 'NP' for a zero-liquidity
    // range, in which case the stored tokensOwed() is the full answer.
    try {
        const [fees0, fees1] = await positionManager.callStatic.quoteTokensOwed(tokenId);
        return { fees0, fees1 };
    } catch {
        const [fees0, fees1] = await positionManager.tokensOwed(tokenId);
        return { fees0, fees1 };
    }
}
```

## Range Strategies

### Full Range Position

```javascript
const MIN_TICK = -887272;
const MAX_TICK = 887272;

// Tick spacing is a per-pool immutable chosen at creation, not a function of
// the fee (VinuSwap has no fee -> tickSpacing table). Read it from the pool.
async function getTickSpacing(token0, token1, fee) {
    const poolAddress = await factory.getPool(token0, token1, fee);
    return new ethers.Contract(poolAddress, poolABI, provider).tickSpacing();
}

async function createFullRangePosition(token0, token1, fee, amount0, amount1) {
    const tickSpacing = await getTickSpacing(token0, token1, fee);
    const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
    const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

    return createPosition(token0, token1, fee, tickLower, tickUpper, amount0, amount1);
}
```

### Narrow Range Position

```javascript
async function createNarrowPosition(
    token0,
    token1,
    fee,
    currentPrice,
    rangePercent,  // e.g., 5 for ±5%
    amount0,
    amount1
) {
    const tickSpacing = await getTickSpacing(token0, token1, fee);
    const currentTick = priceToTick(currentPrice);

    const ticksFromCurrent = Math.ceil(
        Math.log(1 + rangePercent / 100) / Math.log(1.0001)
    );

    const tickLower = nearestUsableTick(currentTick - ticksFromCurrent, tickSpacing);
    const tickUpper = nearestUsableTick(currentTick + ticksFromCurrent, tickSpacing);

    return createPosition(token0, token1, fee, tickLower, tickUpper, amount0, amount1);
}
```

## Error Handling

```javascript
async function safeCreatePosition(params) {
    try {
        return await createPosition(...params);
    } catch (error) {
        if (error.message.includes('Price slippage check')) {
            throw new Error('Price moved, increase slippage tolerance');
        }
        if (error.message.includes('TLU')) {
            throw new Error('tickLower must be less than tickUpper');
        }
        if (error.message.includes('TLM') || error.message.includes('TUM')) {
            throw new Error('Tick out of valid range');
        }
        throw error;
    }
}
```

## Next Steps

- [Position Locking](position-locking.md)
- [Fee Discounts](fee-discounts.md)
- [NonfungiblePositionManager Reference](../reference/periphery/position-manager.md)
