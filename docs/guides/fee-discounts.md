# Fee Discounts

VinuSwap includes a dynamic fee system that can provide discounts based on token holdings.

## Overview

Pools do not hardcode discount rules. Each pool has a `feeManager` address, and
that manager decides the effective fee used during each swap. VinuSwap ships
three fee-manager patterns:

- `NoDiscount`: returns the pool base fee unchanged.
- `TieredDiscount`: checks a discount token balance and returns a reduced fee.
- `OverridableFeeManager`: forwards to a default fee manager unless a specific
  pool override is configured.

> **Live default on VinuChain (block 14680456, 2026-08-27):** every current-factory
> pool points at `OverridableFeeManager`
> (`0xA15770c5692646667c195446996e1fE9D210374c`), whose `defaultFeeManager()` is a
> **`NoDiscount`** deployment at `0xb96178F0517A4E2268B85a76ccFeA7E8382Ca1be`, with
> no per-pool overrides. **Discounts are therefore inactive on all current pools.**
> `TieredDiscount` (`0x58818859dD0179498c530f549270F40fEB48579E`, tiers
> 100B/500B/1T/5T/10T VINU → 5/10/25/50/75%) is deployed but only routed by the
> six legacy pools. Running `configure:discount-defaults`
> (`set_default_discount_fee_manager.ts`) would activate it everywhere; that
> changes live economics and needs explicit confirmation. Always resolve the
> live manager as shown below rather than assuming either state.

The exact tiers are deployment configuration, not protocol constants. A live UI
should resolve the pool's effective fee manager before showing a discount.

## How It Works

1. User initiates a swap
2. Pool calls `feeManager.computeFee(baseFee)`
3. If the effective manager is `TieredDiscount`, it checks `tx.origin`'s token balance
4. Returns discounted fee based on tier
5. Swap executes with reduced fee

```
Base Fee: 0.30%
Configured Tier: balance >= deployment threshold, discount = 300 bps

Effective Fee = 0.30% * (1 - 0.03) = 0.291%
```

## Checking Your Discount

Before reading tiers, resolve the pool's effective manager:

```javascript
async function getEffectiveFeeManager(poolAddress, poolFeeManager) {
    const feeManager = new ethers.Contract(poolFeeManager, [
        'function feeManagerOverride(address) view returns (address)',
        'function defaultFeeManager() view returns (address)'
    ], provider);

    try {
        const override = await feeManager.feeManagerOverride(poolAddress);

        if (override !== ethers.constants.AddressZero) {
            return override;
        }

        return await feeManager.defaultFeeManager();
    } catch {
        return poolFeeManager;
    }
}
```

If the effective manager does not expose `token()`, `thresholds(uint256)`, and
`discounts(uint256)`, the pool should be displayed as having no active tiered
discount.

### Get Current Discount Tier

```javascript
async function readDiscountTiers(discountContract) {
    const tiers = [];

    for (let i = 0; ; i++) {
        try {
            tiers.push({
                threshold: await discountContract.thresholds(i),
                discountBps: await discountContract.discounts(i)
            });
        } catch {
            break;
        }
    }

    return tiers;
}

async function getMyDiscount(discountContract, signerAddress) {
    const discountTokenAddress = await discountContract.token();
    const discountToken = new ethers.Contract(
        discountTokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
    );
    const myBalance = await discountToken.balanceOf(signerAddress);
    const tiers = await readDiscountTiers(discountContract);

    // Find applicable tier
    let myDiscount = 0;
    for (const tier of tiers) {
        if (myBalance.gte(tier.threshold)) {
            myDiscount = tier.discountBps;
        } else {
            break;
        }
    }

    return {
        balance: myBalance,
        discountBps: myDiscount,
        discountPercent: myDiscount / 100,
        tiers
    };
}

// Usage
const { discountPercent } = await getMyDiscount(tieredDiscount, signer.address);
console.log(`Your fee discount: ${discountPercent}%`);
```

### Calculate Effective Fee

```javascript
function calculateEffectiveFee(baseFee, discountBps) {
    // baseFee in hundredths of bips (3000 = 0.3%)
    // discountBps in basis points (300 = 3%)
    return baseFee * (10000 - discountBps) / 10000;
}

// Example
const baseFee = 3000;  // 0.3%
const discount = 300;   // 3%
const effectiveFee = calculateEffectiveFee(baseFee, discount);
// effectiveFee = 2910 (0.291%)
```

## Estimating Savings

### Per-Swap Savings

```javascript
async function estimateSwapSavings(
    tokenIn,
    tokenOut,
    poolFee,
    amountIn,
    discountBps
) {
    // Get quote at base fee (IQuoterV2 uses struct parameters)
    const [amountOut] = await quoter.callStatic.quoteExactInputSingle({
        tokenIn,
        tokenOut,
        amountIn,
        fee: poolFee,
        sqrtPriceLimitX96: 0
    });

    // Calculate fee amounts
    const baseFeeAmount = amountIn.mul(poolFee).div(1000000);
    const discountedFeeAmount = baseFeeAmount.mul(10000 - discountBps).div(10000);
    const savings = baseFeeAmount.sub(discountedFeeAmount);

    return {
        baseFee: baseFeeAmount,
        discountedFee: discountedFeeAmount,
        savings,
        savingsPercent: discountBps / 100
    };
}
```

### Annual Savings Projection

```javascript
function projectAnnualSavings(
    avgSwapSize,
    swapsPerMonth,
    baseFeePercent,
    discountPercent
) {
    const monthlyVolume = avgSwapSize * swapsPerMonth;
    const annualVolume = monthlyVolume * 12;

    const baseFees = annualVolume * (baseFeePercent / 100);
    const discountedFees = baseFees * (1 - discountPercent / 100);
    const annualSavings = baseFees - discountedFees;

    return {
        annualVolume,
        baseFees,
        discountedFees,
        annualSavings
    };
}

// Example: $10,000 swaps, 20x/month, 0.3% fee, 3% discount
const projection = projectAnnualSavings(10000, 20, 0.3, 3);
// annualSavings = $21.6 per year
```

## Acquiring Discount Tokens

### Buy on VinuSwap

```javascript
async function buyDiscountTokens(amountToBuy) {
    // Get quote (IQuoterV2 uses struct parameters)
    const [amountIn] = await quoter.callStatic.quoteExactOutputSingle({
        tokenIn: WVC,
        tokenOut: DISCOUNT_TOKEN,
        amount: amountToBuy,
        fee: 3000,
        sqrtPriceLimitX96: 0
    });

    // Execute swap
    await router.exactOutputSingle({
        tokenIn: WVC,
        tokenOut: DISCOUNT_TOKEN,
        fee: 3000,
        recipient: signer.address,
        deadline: Math.floor(Date.now() / 1000) + 1800,
        amountOut: amountToBuy,
        amountInMaximum: amountIn.mul(105).div(100),  // 5% slippage
        sqrtPriceLimitX96: 0
    });
}
```

### Calculate Breakeven

```javascript
function calculateBreakeven(
    tokenPrice,
    tokensNeeded,
    annualSavings
) {
    const investment = tokenPrice * tokensNeeded;
    const breakEvenMonths = investment / (annualSavings / 12);

    return {
        investment,
        annualSavings,
        breakEvenMonths,
        breakEvenYears: breakEvenMonths / 12
    };
}

// Example using a threshold read from the live discount contract
const tier = (await readDiscountTiers(discountContract))[0];
const discountToken = new ethers.Contract(
    await discountContract.token(),
    ['function decimals() view returns (uint8)'],
    provider
);
const tokenDecimals = await discountToken.decimals();
const breakeven = calculateBreakeven(
    0.001,      // $0.001 per token
    Number(ethers.utils.formatUnits(tier.threshold, tokenDecimals)),
    21.6        // $21.6 annual savings
);
console.log(`Break-even: ${breakeven.breakEvenYears.toFixed(1)} years`);
```

## Pool-Specific Discounts

Some pools may have different discount configurations using OverridableFeeManager:

```javascript
async function getPoolFeeManager(pool, overridableFeeManager) {
    const override = await overridableFeeManager.feeManagerOverride(pool);

    if (override === ethers.constants.AddressZero) {
        return await overridableFeeManager.defaultFeeManager();
    }
    return override;
}

// Check if pool uses discounts
async function poolHasDiscounts(pool) {
    const feeManager = await getPoolFeeManager(pool, overridableFeeManager);

    // Check whether it exposes the TieredDiscount public accessors.
    try {
        const tieredDiscount = new ethers.Contract(feeManager, tieredDiscountABI, provider);
        await tieredDiscount.token();
        await tieredDiscount.thresholds(0);
        await tieredDiscount.discounts(0);
        return true;  // Has discount token, so has discounts
    } catch {
        return false;  // NoDiscount or different implementation
    }
}
```

## Smart Wallet Caveat

`TieredDiscount.computeFee()` uses `tx.origin`, while `computeFeeFor()` accepts
an arbitrary address for quoting or UI display. This means contract wallets,
aggregators, relayers, and account-abstraction flows may not receive the same
discount a UI predicts for the connected account unless the transaction origin
actually holds the discount token.

## Discount Tiers Visualization

Render the current on-chain configuration instead of assuming fixed thresholds:

```javascript
async function getDiscountTierRows(discountContract) {
    const tiers = await readDiscountTiers(discountContract);

    return tiers.map((tier) => ({
        threshold: tier.threshold.toString(),
        discountPercent: tier.discountBps / 100
    }));
}
```

## Best Practices

### 1. Check Before Trading

Always check your discount tier before large trades:

```javascript
async function swapWithDiscountInfo(tokenIn, tokenOut, fee, amountIn, discountContract) {
    // Get discount info
    const { discountPercent } = await getMyDiscount(discountContract, signer.address);

    console.log(`Your discount: ${discountPercent}%`);

    // Calculate effective fee
    const effectiveFee = fee * (100 - discountPercent) / 100;
    console.log(`Effective fee: ${effectiveFee / 10000}%`);

    // Proceed with swap
    // ...
}
```

### 2. Consider Token Purchase

For frequent traders, buying discount tokens may be worthwhile:

```javascript
async function shouldBuyDiscountTokens(monthlyVolume, baseFee, discountContract) {
    const tokenAddress = await discountContract.token();
    const token = new ethers.Contract(
        tokenAddress,
        ['function decimals() view returns (uint8)'],
        provider
    );
    const [tiers, decimals, tokenPrice] = await Promise.all([
        readDiscountTiers(discountContract),
        token.decimals(),
        getTokenPrice(tokenAddress)
    ]);

    for (const tier of tiers) {
        const tokenAmount = Number(ethers.utils.formatUnits(tier.threshold, decimals));
        const discountPercent = tier.discountBps / 100;
        const cost = tokenAmount * tokenPrice;
        const annualSavings = monthlyVolume * 12 * (baseFee / 100) * (discountPercent / 100);
        const roiYears = cost / annualSavings;

        console.log(`
            Tier: ${discountPercent}% discount
            Cost: $${cost}
            Annual Savings: $${annualSavings}
            ROI: ${roiYears.toFixed(1)} years
        `);
    }
}
```

### 3. Maintain Balance

Remember that discounts are checked at swap time:

```javascript
// Warning system for low balance
async function checkDiscountStatus(discountContract) {
    const discountTokenAddress = await discountContract.token();
    const discountToken = new ethers.Contract(
        discountTokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
    );
    const balance = await discountToken.balanceOf(signer.address);
    const { discountBps } = await getMyDiscount(discountContract, signer.address);
    const tiers = await readDiscountTiers(discountContract);

    console.log(`Current discount: ${discountBps / 100}%`);

    // Check if close to dropping a tier.
    for (let i = tiers.length - 1; i >= 0; i--) {
        if (balance.gte(tiers[i].threshold)) {
            const buffer = balance.sub(tiers[i].threshold);
            const bufferPercent = buffer.mul(100).div(tiers[i].threshold);

            if (bufferPercent.lt(10)) {
                console.warn(
                    `Warning: You're within 10% of dropping to a lower discount tier!`
                );
            }
            break;
        }
    }
}
```

## Related

- [TieredDiscount Reference](../reference/fees/tiered-discount.md)
- [Fee Management Overview](../reference/fees/overview.md)
- [Executing Swaps](swapping.md)
