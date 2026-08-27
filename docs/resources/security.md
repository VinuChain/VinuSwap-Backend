# Security

Security best practices and considerations for VinuSwap integration.

## Smart Contract Security

### Audited Codebase

VinuSwap is based on Uniswap V3, one of the most thoroughly audited DeFi protocols. The core AMM logic inherits security properties from the battle-tested Uniswap V3 codebase.

A [Security Companion Document](https://github.com/VinuChain/VinuSwap-Backend/blob/main/Security%20Companion%20Document.pdf) specific to VinuSwap's extensions (Controller, TieredDiscount, fee manager system, position locking) is included in the repository root. It is dated 2023-09-04 and predates `OverridableFeeManager`, `createStandardPool`, the unified `createPool` + initialise, and `quoteTokensOwed`; the live ownership graph is in [OWNERSHIP.md](../OWNERSHIP.md).

### Key Security Features

#### 1. Reentrancy Protection

All state-changing functions use the lock modifier:

```solidity
modifier lock() {
    require(slot0.unlocked, 'LOK');
    slot0.unlocked = false;
    _;
    slot0.unlocked = true;
}
```

#### 2. Callback Validation

Periphery contracts validate callbacks to prevent malicious contracts from stealing tokens:

```solidity
CallbackValidation.verifyCallback(factory, poolKey);
```

#### 3. Integer Overflow Protection

- Core contracts use Solidity 0.7.6 with explicit overflow checks
- Critical math operations use safe math libraries
- Q64.96 fixed-point arithmetic prevents precision loss

#### 4. Access Control

- Factory ownership is transferable but protected
- Pool owner actions are restricted to factory owner
- Fee manager changes require owner authorization

## Integration Security

### Slippage Protection

**Always set `amountOutMinimum` or `amountInMaximum`:**

```javascript
// DANGEROUS - No slippage protection
const params = {
    amountIn: parseEther('1'),
    amountOutMinimum: 0,  // ❌ Never do this
    // ...
};

// SAFE - With slippage protection. VinuSwapQuoter implements IQuoterV2:
// struct params, non-view (use callStatic / staticCall), tuple result.
const { amountOut: expectedOut } = await quoter.callStatic.quoteExactInputSingle({
    tokenIn, tokenOut, amountIn: parseEther('1'), fee, sqrtPriceLimitX96: 0
});
const minOut = expectedOut.mul(995).div(1000); // 0.5% slippage

const params = {
    amountIn: parseEther('1'),
    amountOutMinimum: minOut,  // ✅ Protected
    // ...
};
```

### Deadline Protection

**Always set reasonable deadlines:**

```javascript
// DANGEROUS - Far future deadline
const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;  // ❌ 1 year

// SAFE - Short deadline
const deadline = Math.floor(Date.now() / 1000) + 300;  // ✅ 5 minutes
```

### Price Manipulation Resistance

**Use TWAP for price-sensitive operations:**

```javascript
// DANGEROUS - Using spot price for liquidations
const [sqrtPriceX96] = await pool.slot0();  // ❌ Manipulable

// SAFE - Using TWAP
const [tickCumulatives] = await pool.observe([1800, 0]);  // ✅ 30-min TWAP
const twapTick = (tickCumulatives[1] - tickCumulatives[0]) / 1800;
```

### Token Approval Security

**Approve only what's needed:**

```javascript
// LESS SAFE - Infinite approval
await token.approve(router, ethers.constants.MaxUint256);

// SAFER - Exact approval
await token.approve(router, exactAmount);
```

## Common Vulnerabilities

### 1. Front-Running

**Risk:** Transactions visible in mempool can be front-run.

**Mitigation:**
- Use tight slippage tolerances
- Consider private transaction services
- Use commit-reveal schemes for large trades

### 2. Sandwich Attacks

**Risk:** Attackers can sandwich your trade with buy/sell orders.

**Mitigation:**
- Set appropriate `sqrtPriceLimitX96`
- Use shorter deadlines
- Split large trades

### 3. Oracle Manipulation

**Risk:** Large trades can manipulate spot prices within a single block.

**Mitigation:**
- Never use spot price for critical decisions
- Use TWAP with sufficient history
- Consider multiple oracle sources

### 4. Rounding Errors

**Risk:** Precision loss in calculations.

**Mitigation:**
- Use full precision libraries
- Round in protocol's favor for fees
- Test edge cases thoroughly

## Callback Security

When implementing callbacks, always verify the caller:

```solidity
function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
) external override {
    // CRITICAL: Verify callback source
    CallbackValidation.verifyCallback(factory, poolKey);

    // Only then transfer tokens
    // ...
}
```

**Note:** VinuSwap uses Uniswap V3 callback interface names for compatibility.

## Position Security

### Locked Positions

VinuSwap supports position locking to prevent **liquidity withdrawal**, not
transfers:

```javascript
// Lock position (extend-only, irreversible, no upper bound)
const deadline = Math.floor(Date.now() / 1000) + 300;
await positionManager.lock(tokenId, lockedUntil, deadline);

// Until lockedUntil: decreaseLiquidity reverts 'Locked'.
// Still allowed: collect, increaseLiquidity, transfers (the lock travels with
// the NFT), and burn once liquidity and tokensOwed are zero.
// Any approved operator can also extend the lock.
```

### NFT Safety

- Store position NFTs in secure wallets
- Consider multi-sig for high-value positions
- Be cautious with NFT approvals

## Deployment Security

### Pre-Deployment Checklist

- [ ] Verify all contract addresses
- [ ] Test on testnet first
- [ ] Verify init code hash matches
- [ ] Check fee tier parameters
- [ ] Validate token addresses (checksummed)

### Post-Deployment Verification

```javascript
// Verify pool deployment
const pool = await factory.getPool(token0, token1, fee);
const computedPool = computePoolAddress(factory, token0, token1, fee);
assert(pool === computedPool, "Pool address mismatch");

// Verify pool initialization
const slot0 = await poolContract.slot0();
assert(slot0.sqrtPriceX96.gt(0), "Pool not initialized");
```

## Emergency Procedures

### If You Suspect a Vulnerability

1. **Do not** publicly disclose the vulnerability
2. Document the issue thoroughly
3. Contact the VinuSwap security team
4. Allow time for mitigation before disclosure

### Incident Response

- Monitor for unusual activity
- Have emergency contacts ready
- Prepare withdrawal procedures
- Document all actions taken

## Security Resources

### Tools

- **Slither** - Static analysis
- **Mythril** - Symbolic execution
- **Echidna** - Fuzzing
- **Foundry** - Testing framework

### References

- [Uniswap V3 Audit Reports](https://uniswap.org/audit)
- [OWASP Smart Contract Top 10](https://owasp.org/www-project-smart-contract-top-10/)
- [ConsenSys Best Practices](https://consensys.github.io/smart-contract-best-practices/)

## Related

- [Architecture](../overview/architecture.md)
- [Core Contracts](../reference/core/overview.md)
- [Callback Validation](../reference/libraries/callback-validation.md)
