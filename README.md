# VinuSwap

Pool-based token swapping contract, based on Uniswap v3.

VinuSwap is a deliberately thin fork of Uniswap v3: all tick / sqrt-price /
liquidity / fee-growth math is imported unmodified from the `@uniswap/v3-core`
npm package, and the vendored periphery is byte-identical to
`@uniswap/v3-periphery` except for the documented deltas below.

## Notable differences from Uniswap v3

- **Custom discounts** — each pool holds an immutable `feeManager`; `swap()` calls
  `IFeeManager.computeFee(fee)` per swap step and enforces `actualFee <= fee`.
  Implementations include `NoDiscount`, balance-tiered `TieredDiscount` (keyed on
  `tx.origin`), and `OverridableFeeManager` (owner-mutable default + per-pool
  override).
- **Controller** — owns the factory; provides permissioned `createPool` (owner)
  and permissionless `createStandardPool` (owner-set default fee manager / tick
  spacing), and collects + splits protocol fees to a fixed payee table via
  pull-payment `withdraw`.
- **Position locking** — the NonfungiblePositionManager adds `lockedUntil` and an
  extend-only `lock()`; `decreaseLiquidity` is blocked while locked, while
  `collect` and transfers remain allowed.
- **Permissioned initialize** — a pool's `initialize` is `onlyFactoryOwner`.
- **`flash()` removed** — flash loans are not supported (size reduction); the
  `IUniswapV3FlashCallback` interface is unused.
- **Owner-only pool creation** — the factory's `createPool` is owner-only and
  takes a free-form `tickSpacing` + `feeManager` instead of the fixed fee-tier
  enum.
- **Modified NFPM ABI** — `positions()` returns 11 values including `lockedUntil`,
  with `tokensOwed*` moved to a separate `tokensOwed()` getter; quoting uses the
  QuoterV2-style param structs (`IQuoterV2`). Third-party Uniswap tooling must be
  adapted accordingly.

## Admin & trust model

Privileged roles (Controller owner, fee-manager owners) form a single `Ownable`
chain under **single-key custody** (the accepted governance model). The owner can
halt swaps (via a reverting fee manager), zero LP fee revenue (via 100%
discounts), and reconfigure pool creation — but cannot drain LP funds, since
`mint`/`burn`/`collect` do not consult the fee manager. See
[`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) for the full ownership chain, per-role
powers, and the incident runbook.

## Documentation

- [`docs/`](docs/) — GitBook architecture, deployment, and contract reference.
- `Security Companion Document.pdf` — first-party enumeration of every delta, its
  rationale, and known concerns. Dated 2023-09-04; it predates
  `OverridableFeeManager`, `createStandardPool`, the unified `createPool` +
  initialise, and `quoteTokensOwed`, so treat `docs/` as authoritative where
  they differ.
- [`docs/deployments/vinuchain-207.json`](docs/deployments/vinuchain-207.json) —
  mainnet deployment record (addresses, deploy txs/blocks, code hashes, legacy
  sets).
- [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) — ownership chain and emergency
  procedures.

# Installing

```
git clone https://github.com/VinuChain/VinuSwap-Backend
npm install
```

# Running Tests

```
npm run test
```
