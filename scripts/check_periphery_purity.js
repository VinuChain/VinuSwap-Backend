#!/usr/bin/env node
// Upstream-purity check for the vendored Uniswap v3-periphery sources.
//
// Why this exists (see audit 04-VinuSwap-Backend.md, finding M-2 / Theme 2):
// VinuSwap imports all v3-CORE math straight from the `@uniswap/v3-core` npm
// package (see contracts/core/VinuSwapPool.sol imports) -- there are NO vendored
// copies of Tick/TickMath/SqrtPriceMath/SwapMath in contracts/core/, so core math
// cannot drift by construction and needs no hash check.
//
// The periphery is different: those sources ARE vendored into
// contracts/periphery/. The audit established that the vendored periphery is
// source-identical to `@uniswap/v3-periphery` except for three intentionally
// modified files (NFTDescriptor.sol, PoolAddress.sol, PositionValue.sol). This
// script re-asserts that invariant: every file listed below must remain
// source-identical to its upstream counterpart, so any silent drift (a stray
// edit, a dependency bump that changes upstream) fails loudly in CI.
//
// If you intentionally diverge a file, move it out of EXPECTED_IDENTICAL and
// document the delta (and update the audit + docs) -- do not weaken this check.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const repoRoot = path.resolve(__dirname, '..')
const vendoredRoot = path.join(repoRoot, 'contracts', 'periphery')
const upstreamRoot = path.join(
    repoRoot,
    'node_modules',
    '@uniswap',
    'v3-periphery',
    'contracts'
)

// Relative paths (under contracts/periphery and the upstream contracts/ root)
// that MUST stay source-identical to the published @uniswap/v3-periphery package.
const EXPECTED_IDENTICAL = [
    'base/BlockTimestamp.sol',
    'base/ERC721Permit.sol',
    'base/LiquidityManagement.sol',
    'base/Multicall.sol',
    'base/PeripheryImmutableState.sol',
    'base/PeripheryPayments.sol',
    'base/PeripheryPaymentsWithFee.sol',
    'base/PeripheryValidation.sol',
    'base/SelfPermit.sol',
    'libraries/BytesLib.sol',
    'libraries/CallbackValidation.sol',
    'libraries/ChainId.sol',
    'libraries/HexStrings.sol',
    'libraries/LiquidityAmounts.sol',
    'libraries/NFTSVG.sol',
    'libraries/OracleLibrary.sol',
    'libraries/Path.sol',
    'libraries/PoolTicksCounter.sol',
    'libraries/PositionKey.sol',
    'libraries/SqrtPriceMathPartial.sol',
    'libraries/TokenRatioSortOrder.sol',
    'libraries/TransferHelper.sol',
    'interfaces/IERC20Metadata.sol',
    'interfaces/IERC721Permit.sol',
    'interfaces/IMulticall.sol',
    'interfaces/INonfungibleTokenPositionDescriptor.sol',
    'interfaces/IPeripheryImmutableState.sol',
    'interfaces/IPeripheryPayments.sol',
    'interfaces/IPeripheryPaymentsWithFee.sol',
    'interfaces/IQuoter.sol',
    'interfaces/IQuoterV2.sol',
    'interfaces/ISelfPermit.sol',
    'interfaces/ISwapRouter.sol',
    'interfaces/external/IERC1271.sol',
    'interfaces/external/IERC20PermitAllowed.sol',
    'interfaces/external/IWETH9.sol',
]

// VinuSwap-original periphery files that have NO upstream counterpart (e.g. the
// VinuSwap quoter interface). They are intentionally excluded from both lists
// because there is nothing upstream to compare them against.

// Files that are KNOWN and DOCUMENTED to diverge from upstream. Listed here so
// the check can assert they are actually still present and still different --
// if one silently becomes identical again, that is also worth flagging.
const EXPECTED_DIVERGENT = [
    'libraries/NFTDescriptor.sol',
    'libraries/PoolAddress.sol',
    'libraries/PositionValue.sol',
    // INonfungiblePositionManager is a real ABI delta: positions() returns 11
    // values incl. lockedUntil, with tokensOwed* moved to a separate getter.
    'interfaces/INonfungiblePositionManager.sol',
]

function sourceFingerprint(filePath) {
    const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    return crypto.createHash('sha256').update(source).digest('hex')
}

function main() {
    if (!fs.existsSync(upstreamRoot)) {
        console.error(
            `Upstream package not found at ${upstreamRoot}.\n` +
            `Run \`npm ci\` so @uniswap/v3-periphery is installed before this check.`
        )
        process.exit(2)
    }

    const errors = []

    for (const rel of EXPECTED_IDENTICAL) {
        const vendored = path.join(vendoredRoot, rel)
        const upstream = path.join(upstreamRoot, rel)

        if (!fs.existsSync(vendored)) {
            errors.push(`MISSING vendored file: contracts/periphery/${rel}`)
            continue
        }
        if (!fs.existsSync(upstream)) {
            errors.push(`MISSING upstream file: @uniswap/v3-periphery/contracts/${rel}`)
            continue
        }
        if (sourceFingerprint(vendored) !== sourceFingerprint(upstream)) {
            errors.push(
                `DRIFT: contracts/periphery/${rel} no longer matches upstream ` +
                `@uniswap/v3-periphery. If this change is intentional, move it to ` +
                `EXPECTED_DIVERGENT and document the delta.`
            )
        }
    }

    for (const rel of EXPECTED_DIVERGENT) {
        const vendored = path.join(vendoredRoot, rel)
        const upstream = path.join(upstreamRoot, rel)

        if (!fs.existsSync(vendored)) {
            errors.push(`MISSING vendored file: contracts/periphery/${rel}`)
            continue
        }
        if (fs.existsSync(upstream) && sourceFingerprint(vendored) === sourceFingerprint(upstream)) {
            errors.push(
                `UNEXPECTED MATCH: contracts/periphery/${rel} is documented as ` +
                `divergent from upstream but is now source-identical. Review whether ` +
                `it should move to EXPECTED_IDENTICAL.`
            )
        }
    }

    if (errors.length > 0) {
        console.error('Periphery upstream-purity check FAILED:\n')
        for (const e of errors) {
            console.error(`  - ${e}`)
        }
        process.exit(1)
    }

    console.log(
        `Periphery upstream-purity check OK: ` +
        `${EXPECTED_IDENTICAL.length} files source-identical to ` +
        `@uniswap/v3-periphery, ${EXPECTED_DIVERGENT.length} documented deltas intact.`
    )
}

main()
