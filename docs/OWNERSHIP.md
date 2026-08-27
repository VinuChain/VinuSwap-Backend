# VinuSwap Ownership & Governance

This document describes the on-chain ownership model of the VinuSwap deployment:
the chain of privileged roles, exactly what each role can do, and the operational
procedures for responding to an incident. It exists because the audit
(`04-VinuSwap-Backend.md`, finding **H-1**) flagged that the admin model is
powerful and was previously undocumented.

The VinuSwap deployment uses **single-key custody** as its accepted governance
model. This is a deliberate decision: there is no on-chain multisig or timelock
in front of the owner roles. The mitigation is operational discipline plus the
documented emergency procedures below, not additional smart-contract machinery.

> This document does **not** describe where or how owner keys are stored. Key
> custody is intentionally out of scope here.

## Ownership chain

Privilege flows top-down from a single owner key through the Controller:

```
Owner key (EOA)
   │  owns
   ▼
Controller ──(owns via factory.setOwner)──► VinuSwapFactory ──► every pool
   │
   └── also owns: OverridableFeeManager ──► TieredDiscount (fee policy)
```

- The **Controller** is the hub. It owns the **VinuSwapFactory**, and the factory
  is the owner of every pool it deploys. Pool owner actions (`initialize`,
  `setFeeProtocol`, `collectProtocol`) are therefore exercised *through* the
  Controller.
- The **fee managers** (`OverridableFeeManager`, `TieredDiscount`) are separate
  `Ownable` contracts. Each pool holds an immutable pointer to its fee manager;
  production pools point at `OverridableFeeManager`, which delegates to a policy
  contract (`TieredDiscount` or `NoDiscount`). **Live policy today is
  `NoDiscount`** (see "Live state" below).

### Mainnet addresses (VinuChain, chain ID 207)

| Role | Contract | Address |
|------|----------|---------|
| Pool/factory governance hub | Controller | `0x47fF80713b1d66DdA47237AB374F3080E2075528` |
| Pool deployer | VinuSwapFactory | `0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe` |
| Fee-manager router | OverridableFeeManager | `0xA15770c5692646667c195446996e1fE9D210374c` |
| Discount policy (deployed, **not routed**) | TieredDiscount | `0x58818859dD0179498c530f549270F40fEB48579E` |
| Live default policy | NoDiscount | `0xb96178F0517A4E2268B85a76ccFeA7E8382Ca1be` |

Verify the live owner of each contract on-chain with `owner()` before trusting
any of the procedures below. Deploy blocks, transaction hashes, runtime code
hashes and the legacy sets are recorded in
[`docs/deployments/vinuchain-207.json`](deployments/vinuchain-207.json).

## Live state (VinuChain 207, block 14680456, 2026-08-27)

Read-only `eth_call` snapshot. Re-read before acting; nothing below is enforced
by the contracts.

| Item | Live value |
|------|-----------|
| Owner of Controller / OverridableFeeManager / TieredDiscount | EOA `0x12BD0b15D5010De455DCe7944265Fe1D35a84023` (also the deployer of every contract) |
| `VinuSwapFactory.owner()` | Controller `0x47fF80713b1d66DdA47237AB374F3080E2075528` |
| Controller payee table | single account `0xA529d46D97C9be7b93F44A9A0Ca4672C4591B93a`, shares 1000 / totalShares 1000 (`accounts(1)` reverts) |
| Controller ledger (`balanceOf(payee, token)`) | 0 for WVC, USDT, VINU, ETH, BTC; zero `CollectedFees` / `SetFeeProtocol` events |
| `Controller.defaultFeeManager(factory)` | OverridableFeeManager `0xA15770c5692646667c195446996e1fE9D210374c` |
| `OverridableFeeManager.defaultFeeManager()` | `0xb96178F0517A4E2268B85a76ccFeA7E8382Ca1be` — a **NoDiscount** deployment (runtime bytecode identical to the `NoDiscount` artifact; `computeFee(f) == f` for every caller) |
| `OverridableFeeManager.feeManagerOverride(pool)` | `0x0` for every pool (no per-pool overrides) |
| Net effect | **VINU discounts are INACTIVE on all 35 current-factory pools** |
| TieredDiscount `0x5881…579E` | deployed 2024-06-28, owned by the EOA, **not routed**; `token()` = VINU `0x00c1E515EA9579856304198EFb15f525A0bb50f6` |
| TieredDiscount live tiers | 100B VINU → 5%, 500B → 10%, 1T → 25%, 5T → 50%, 10T → 75% (thresholds 1e29/5e29/1e30/5e30/1e31 wei; discounts 500/1000/2500/5000/7500 bps) |
| `slot0.feeProtocol` | 0 on all 35 current-factory pools (no protocol fee accrues) |
| `createStandardPool` defaults (`defaultTickSpacing(factory, fee)`) | 500 → 10, 3000 → 60, 10000 → 200; 100 / 2500 / 5000 → 0 (**disabled**, `createStandardPool` reverts `Tick spacing not set`) |

Running `scripts/main_scripts/set_default_discount_fee_manager.ts` against this
state would flip every current pool from NoDiscount to the 5–75% tier table
above. It changes live economics and requires explicit confirmation.

**Owner decision item.** A second, unreferenced `TieredDiscount` exists at
`0xE86FA507cb7E4E16DA7377baf70845D0016F65E3` (deployer nonce 258, deployed with
the current generation; `token()` = VINU, owned by the same EOA, first tier
1e29 wei → 5%). No script, doc or fee manager points at it. Decide whether it
is the intended policy contract for the current generation or dead weight, and
record the decision here; until then, `set_default_discount_fee_manager.ts`
defaults to `0x5881…579E`.

## What each owner can do

### Controller owner (the root authority)

- `createPool` / `initialize` — create and initialize pools (permissioned).
- `setDefaultFeeManager` / `setDefaultTickSpacing` — configure the parameters used
  by the permissionless `createStandardPool` path. Setting either to its zero
  value (zero address / tick spacing 0) **disables** standard pool creation for
  that factory/fee.
- `setFeeProtocol` — set the protocol-fee split on any pool. The pool accepts
  `0` (off) or `4..10` per token, i.e. 1/4 … 1/10 = **25% down to 10%** of swap
  fees; values 1–3 and >10 revert.
- `collectProtocolFees` — pull accrued protocol fees into the Controller's
  pull-payment ledger (also callable by any configured payee account).
- `transferFactoryOwnership` — reassign the factory's owner. This can **detach the
  factory from the Controller entirely**; treat it as a high-consequence action.
  Read `owner()` of the target and confirm it is a known key **before** calling.
- `renounceOwnership` (inherited from OpenZeppelin `Ownable` on Controller,
  OverridableFeeManager and TieredDiscount) — **never call it**. Renouncing the
  Controller leaves the factory owned by an ownerless contract: no more
  `createPool` / `initialize`, `setDefaultFeeManager` / `setDefaultTickSpacing`,
  `setFeeProtocol` or `transferFactoryOwnership`, with no recovery path. Already
  configured payees can still call `collectProtocolFees` and `withdraw`, and the
  permissionless `createStandardPool` keeps working with whatever defaults were
  set before the renounce, so accrued protocol fees are not stranded.

The Controller's payee table (accounts and shares for protocol-fee splitting) is
fixed at construction and cannot be changed; rotating it requires deploying a new
Controller and migrating factory ownership.

### Fee-manager owners (live trading economics)

- `OverridableFeeManager.setDefaultFeeManager` — swap the global policy contract
  that every pool routes through.
- `OverridableFeeManager.setFeeManagerOverride` — override the policy for a single
  pool.
- `TieredDiscount.updateInfo` — set the discount-tier thresholds and discounts.

The pool enforces `actualFee <= fee` on every swap step (`'IFV'`), so a fee
manager can only ever **reduce** the fee, never raise it above the pool's
immutable fee. The two failure modes a hostile/buggy fee manager can cause are:
(1) a **reverting** `computeFee`, which halts swaps on affected pools (LP
`burn`/`collect` still work — funds are never locked); (2) a **100% discount**,
which zeroes LP fee revenue while trades continue.

## Owner powers summary (trust model)

A single owner key, if compromised or misused, can:

- Halt swaps on all pools by pointing the fee manager at a reverting contract.
- Zero out LP fee revenue by configuring 100% discounts.
- Brick pool owner functions by fat-fingering factory ownership to a dead address.

It **cannot** drain LP funds: `mint`/`burn`/`collect` do not consult the fee
manager, and swap settlement still enforces the canonical balance checks. The
governance risk is denial-of-service and fee-economics manipulation, not theft.

## Emergency procedures (incident runbook)

### Symptom: swaps are reverting (suspected fee-manager fault)

The fastest mitigation is to route pools to `NoDiscount`, which always returns the
unchanged fee and cannot revert.

1. Identify the affected pool(s). If global, treat all production pools as affected.
2. Point the global policy back to a known-good `NoDiscount` deployment:
   `OverridableFeeManager.setDefaultFeeManager(<NoDiscount address>)`.
3. Or, for a single pool, override just that pool:
   `OverridableFeeManager.setFeeManagerOverride(<pool>, <NoDiscount address>)`.
4. Confirm a test swap succeeds on an affected pool before standing down.

### Symptom: discounts misconfigured (e.g. unintended 100% tier)

1. Correct the tier table with `TieredDiscount.updateInfo(...)`, or
2. Temporarily route pools to `NoDiscount` (steps above) while a corrected
   `TieredDiscount` is prepared and deployed.

### Symptom: owner key suspected compromised

1. Immediately route all pools to `NoDiscount` to neutralize fee-policy abuse
   (steps above), if the key is still usable by the legitimate operator.
2. Plan an ownership migration: deploy fresh fee-manager/Controller contracts as
   needed and transfer ownership to a new key. Note that the live factory and
   pools cannot be upgraded; migration is via `transferFactoryOwnership` and
   redeployment of off-pool governance contracts.

### Position locks (not an owner power, but irreversible)

`NonfungiblePositionManager.lock(tokenId, lockedUntil, deadline)` is
extend-only, has **no upper bound** and **no unlock**, and is callable by the
owner **or any approved operator** of the NFT. It blocks only
`decreaseLiquidity`; `collect`, `increaseLiquidity`, transfers and `burn` (once
liquidity and owed tokens are zero) remain allowed. The owner key cannot undo a
lock.

### Rehearsal

Any ownership-transfer or fee-manager-swap procedure should be rehearsed on a
testnet deployment (`scripts/main_scripts/deploy_core.ts`) before being executed
against mainnet. Every script under `scripts/main_scripts/` runs through
`preflight.ts`: the provider chain ID must equal the network's pinned one, the
signer must be `owner()` of every mutated target, every target must have code
(and, where an artifact is named, match its HEAD `deployedBytecode` modulo
metadata), and every write is `callStatic`-simulated, printed before/after,
gated on confirmation and re-read afterwards. `test/scripts.spec.ts` runs the
same scripts end-to-end on the hardhat network in CI.

Environment contract (besides `VINUSWAP_OWNER_PRIVATE_KEY` / `VINUSWAP_RPC_URL`
from `.env.example`):

| Variable | Effect |
|----------|--------|
| `VINUSWAP_CONFIRM=<target address\|yes>` | Required for every write. The exact target address confirms writes to that one contract; `yes` confirms everything (contract deployments accept only `yes`). Unset: the script simulates, prints, and refuses. |
| `VINUSWAP_DEPLOYMENTS_DIR` | Directory for the JSON run record; default `deployments/` at the repo root. |
| `VINUSWAP_INIT_CODE_HASH=<hash>` | Only for deploying periphery against a factory that has **no pools yet and is not pinned** (`deploy_quoter.ts`): declares the pool init code hash you verified from that factory's source/`PoolInitHelper`; it must equal the hash the compiled periphery embeds. Without it such a factory is refused. `deploy_core.ts` needs no declaration (it just deployed the factory). |
| `VINUSWAP_ALLOW_BYTECODE_MISMATCH=<addr[,addr]>` | Proceed against a target whose live bytecode differs from the named HEAD artifact. Set it only after establishing which source revision the live contract was built from. |
| `VINUSWAP_POOL_FEE_MANAGER` | `deploy_next_pool.ts`: fee manager for the new pool instead of `Controller.defaultFeeManager(factory)`. The zero address is refused either way. |
| `VINUSWAP_DEFAULT_DISCOUNT=tiered` | `deploy_core.ts`: route the fresh `OverridableFeeManager` at `TieredDiscount` instead of `NoDiscount`. |
| `COINGECKO_DEMO_API_KEY` | `deploy_next_pool.ts`: required for the initial-price lookup; export it, never commit it. |

Every run writes `deployments/<network>-<timestamp>.json` with the chain ID,
signer, and each deploy and mutation (tx hash, block, before/after state). It
is the only durable copy of a new pool's address if the script fails after
`createPool`; fold a mainnet run into
[`docs/deployments/vinuchain-207.json`](deployments/vinuchain-207.json).

**Mainnet refusals by default.** The live Controller (`0x47fF…5528`) and
TieredDiscount (`0x5881…579E`) do not match the HEAD artifacts (see "Source vs
deployed bytecode"), so `deploy_next_pool.ts` (asserts the Controller artifact)
and `set_default_discount_fee_manager.ts` (asserts Controller and
TieredDiscount) refuse against mainnet unless
`VINUSWAP_ALLOW_BYTECODE_MISMATCH` lists those addresses. `deploy_quoter.ts`
refuses against the live factory with no override: HEAD periphery artifacts
embed the local `POOL_INIT_CODE_HASH` and cannot reproduce the live pools.

**Key rotation (operator action).** A CoinGecko demo key was previously
committed in `scripts/main_scripts/deploy_next_pool.ts`. Treat it as leaked:
revoke it in the CoinGecko dashboard and issue a new one, supplied only via
`COINGECKO_DEMO_API_KEY`. This repository cannot do that for you.

## Source vs deployed bytecode

HEAD `contracts/periphery/Controller.sol` (daf4c76, 2026-06-07) and
`TieredDiscount.sol` (b05e56c, 2026-06-05) **postdate the deployed bytecode**.
In particular the deployed TieredDiscount does **not** have the
`require(_token != address(0))` guard in `updateInfo`, and a HEAD compile does not
reproduce either contract. `OverridableFeeManager` and `NoDiscount` match HEAD
exactly; Factory/Router/NFPM/Quoter differ only in immutables and the
`POOL_INIT_CODE_HASH` constant (live `0xe8b892…596e`, HEAD `0xabbbd0d1…ea3f`).
Per-contract detail: [`docs/deployments/vinuchain-207.json`](deployments/vinuchain-207.json).

## Known immutable defect: position NFT descriptor

The live `NonfungibleTokenPositionDescriptor`
(`0xCA04dFDEE5778f6c23a7BdBa46A8D95F5094e4B5`) was deployed with
`nativeCurrencyLabel() == "VinuSwap Position"` instead of `VC`, its `tokenURI`
names carry `Uniswap` branding, and `tokenURI` **reverts** for USDT/WVC
positions (tokenIds 1 and 3). Root cause: the upstream
`NFTDescriptor.fixedPointToDecimalString` reverts when rendering the price of
a non-`MIN_TICK` lower tick for a 6/18-decimal pair; full-range (`MIN`/`MAX`)
positions render. The defect is in the deployed generation's code, so the fix
is a future-generation one: the NFPM's descriptor pointer is immutable and this
can only be fixed with a new descriptor **and** a new NFPM. No on-chain funds
are affected.

## Legacy deployments

Two earlier generations are still live and hold liquidity. Full records
(deploy blocks, tx hashes, code hashes) are in
[`docs/deployments/vinuchain-207.json`](deployments/vinuchain-207.json).

- **Old Controller** `0x4bC45A5db58d4535FaF668F392035407d2a14E76` (2024-06-28):
  owner = the same EOA `0x12BD…4023`; same single payee `0xA529…B93a`
  1000/1000. Old ABI (no `defaultFeeManager` getter). It owns **both** legacy
  factories.
- **Legacy factory 1** `0x822F75e07E54C7168C7b962fC5155c77A91b5939` (owner = old
  Controller), with router `0xdd9fE9159221f02FE24d0D325D865220714E19f9`, NFPM
  `0xdF6894C78D729A8cFa09574A41f5F0835629B33c`, quoter
  `0x6767A6c094C66Aab096e4f2E0d6ab9592458eC79`, descriptor
  `0x749a4ae26eA2B656321fE299c87f94Fa25703741`. Pools (all fee 2500):
  - `0xa97FA6E9A764306107F2103a2024Cfe660c5dA33` USDT/WVC
  - `0xfD763943f628e125CEE3D8d85DC0fc7098355d16` VINU/ETH
  - `0x8d713bC2d35327B536A8B2CCec9392e57C0D04B4` ETH/WVC
  - `0xd50ee26F62B1825d14e22e23747939D96746434c` VINU/WVC
  - `0x3AefC7Ff49ad0CB62A71BFF3DA8444BA1eA7b9EA` VINU/USDT — retired, liquidity 0,
    not in the frontend config
- **Legacy factory 2** `0x9070A6cf592C2602A5d1DA35fc656577f42454C5` (2024-09-04,
  owner = old Controller), with router `0xadcc675ed0D1848B0809Ffd30dEb69A7cA758260`,
  NFPM `0xa2Bb7D3ccc2E0C8827cf5f5225FB5474d99ADa2A`, quoter
  `0x6998580Bf1979Cb4eD881a93678B97717d54cA51`. Pool:
  `0x3424b0dd7715C8db92414DB0c5A9E5FA0D51cCb5` VINU/USDT 2500.

Legacy pools run a **different economic regime** from current pools: their
`feeManager` is TieredDiscount `0x5881…579E` directly (discounts are live there)
and `feeProtocol` is 5/5 (20%). Uncollected protocol fees sit in the pools and
can only be pulled through the **old** Controller (`protocolFees()` raw units,
`token0` / `token1`):

| Pool | token0 owed | token1 owed |
|------|-------------|-------------|
| `0xa97F…dA33` USDT/WVC | 21,692,505 (USDT, 6 dec) | 11,771,087,947,025,251,324,015 (WVC) |
| `0xfD76…5d16` VINU/ETH | 7,155,778,280,743,868,223,502 (VINU) | 1,467,594,560,624 (ETH) |
| `0x8d71…04B4` ETH/WVC | 1,283,362,686 (ETH) | 743,934,028,702,408,568 (WVC) |
| `0xd50e…434c` VINU/WVC | 881,429,562,461,374,436,095,625,874 (VINU) | 1,775,285,173,611,367,441,088 (WVC) |
| `0x3Aef…b9EA` VINU/USDT (retired) | 1,040,794,509,086,792,692,352 (VINU) | 8,425 (USDT, 6 dec) |
| `0x3424…cCb5` VINU/USDT | 689,270,141,836,927,469,818,730,372 (VINU) | 9,782,401 (USDT, 6 dec) |

## Notes for future deployments

These are recommendations for the *next* contract generation; the live deployment
cannot be upgraded:

- Add events to `setDefaultFeeManager`, `setFeeManagerOverride`, and `updateInfo`
  so indexers and users can monitor fee-policy changes (audit L-4).
- Consider a two-step ownership transfer to remove the single-step `setOwner`
  foot-gun (audit H-1).
- Consider a cap below 100% on configurable discounts (audit M-1).
- Adopt `Ownable2Step` and remove `renounceOwnership`; restrict `lock()` to the
  NFT owner and cap its duration.
- Redeploy the position descriptor with `nativeCurrencyLabel = VC`, VinuSwap
  branding, and a `tokenURI` that does not revert for 6-decimal pairs.
