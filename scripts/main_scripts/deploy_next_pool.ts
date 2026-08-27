// Creates + initializes the next pool listed in deployment_config.json (swapPools without an
// address) through Controller.createPool, using the Controller's default fee manager for the
// factory (OverridableFeeManager on the live topology) unless VINUSWAP_POOL_FEE_MANAGER is set.
import readline from 'readline'
import { ethers } from 'hardhat'
import bn from 'bignumber.js'
import { Preflight, loadJsonFile, saveJsonFile } from './preflight'

const TICK_SPACINGS = {
    low: 10,
    medium: 60,
    high: 200,
}

const ZERO_ADDRESS = ethers.constants.AddressZero

const FixedMathBN = bn.clone({ DECIMAL_PLACES: 40, EXPONENTIAL_AT: 999999 })

async function queryPrices(coins) {
    const apiKey = process.env.COINGECKO_DEMO_API_KEY
    if (!apiKey) {
        throw new Error('COINGECKO_DEMO_API_KEY is not set; export it (never commit it) before deploying a pool')
    }

    const coinGeckoToInternalId: { [key: string]: string } = {}
    for (const [internalId, coin] of Object.entries(coins) as [string, any][]) {
        coinGeckoToInternalId[coin.coingeckoId] = internalId
    }
    console.log('Coingecko to internal ID:', coinGeckoToInternalId)

    const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(coinGeckoToInternalId).join(',')}&vs_currencies=usd`,
        { headers: { 'Content-Type': 'application/json', 'x-cg-demo-api-key': apiKey } }
    )
    if (!response.ok) {
        throw new Error(`CoinGecko request failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()

    const results: { [key: string]: string } = {}
    for (const [key, value] of Object.entries(data) as [string, any][]) {
        results[coinGeckoToInternalId[key]] = value?.usd?.toString()
    }
    console.log('Prices:', results)
    return results
}

export function encodePrice(ratio: string): string {
    return new FixedMathBN(ratio).sqrt().multipliedBy(new FixedMathBN(2).pow(96)).integerValue(3).toString()
}

/// Resolves the fee manager for a new pool: the explicit VINUSWAP_POOL_FEE_MANAGER override,
/// else Controller.defaultFeeManager(factory). Refuses the zero address either way (a pool with
/// a code-less fee manager accepts liquidity but can never swap).
export async function resolvePoolFeeManager(controller, factoryAddress: string): Promise<string> {
    const override = process.env.VINUSWAP_POOL_FEE_MANAGER
    const feeManager = ethers.utils.getAddress(override || (await controller.defaultFeeManager(factoryAddress)))
    if (feeManager === ZERO_ADDRESS) {
        throw new Error(`Controller has no default fee manager for factory ${factoryAddress}; set one or pass VINUSWAP_POOL_FEE_MANAGER`)
    }
    if (override) {
        console.log('Using fee manager override:', feeManager)
    }
    return feeManager
}

export async function deployPool(
    pre: Preflight,
    controllerAddress: string,
    factoryAddress: string,
    tokenA: string,
    tokenB: string,
    fee: number,
    protocolFee: number,
    tickSpacing: number,
    sqrtPriceX96: string
) {
    // Pool.setFeeProtocol accepts 0 or 4..10 (protocol takes 1/N of swap fees); reject before the
    // irreversible createPool, otherwise deployment_config.json is left without the pool address.
    if (!Number.isInteger(protocolFee) || (protocolFee !== 0 && (protocolFee < 4 || protocolFee > 10))) {
        throw new Error(`protocolFeeFraction must be 0 or an integer 4..10 (protocol takes 1/N of swap fees), got ${protocolFee}`)
    }
    const controller = await ethers.getContractAt('Controller', controllerAddress)
    const factory = await ethers.getContractAt('VinuSwapFactory', factoryAddress)

    await pre.assertCode('Controller', controllerAddress, 'Controller')
    await pre.assertCode('Factory', factoryAddress)
    await pre.assertOwner('Controller', controller)
    if (ethers.utils.getAddress(await factory.owner()) !== ethers.utils.getAddress(controllerAddress)) {
        throw new Error(`Factory ${factoryAddress} is not owned by Controller ${controllerAddress}`)
    }
    const feeManager = await resolvePoolFeeManager(controller, factoryAddress)
    await pre.assertCode('Fee manager', feeManager)

    console.log('Deploying a pool:', { controllerAddress, factoryAddress, tokenA, tokenB, fee, protocolFee, tickSpacing, feeManager, sqrtPriceX96 })

    const receipt = await pre.mutate({
        label: 'controller.createPool',
        contract: controller,
        method: 'createPool',
        args: [factoryAddress, tokenA, tokenB, fee, tickSpacing, feeManager, sqrtPriceX96],
        readState: () => factory.getPool(tokenA, tokenB, fee),
    })
    const created = receipt.events?.find((e) => e.event === 'PoolCreated')
    if (!created) {
        throw new Error('Controller did not emit PoolCreated')
    }
    const poolContract = await ethers.getContractAt('VinuSwapPool', created.args.pool)
    console.log('Pool deployed to', poolContract.address)

    const slot0 = await poolContract.slot0()
    if (slot0.sqrtPriceX96.toString() !== sqrtPriceX96) {
        throw new Error(`Pool initialized at ${slot0.sqrtPriceX96} instead of ${sqrtPriceX96}`)
    }
    if (ethers.utils.getAddress(await poolContract.feeManager()) !== feeManager) {
        throw new Error('Pool fee manager does not match the requested fee manager')
    }

    if (protocolFee > 0) {
        await pre.mutate({
            label: 'controller.setFeeProtocol',
            contract: controller,
            method: 'setFeeProtocol',
            args: [poolContract.address, protocolFee, protocolFee],
            readState: async () => (await poolContract.slot0()).feeProtocol,
            expectedAfter: protocolFee + (protocolFee << 4),
        })
    }

    return poolContract
}

function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) =>
        rl.question(query, (ans) => {
            rl.close()
            resolve(ans)
        })
    )
}

async function main() {
    const config = loadJsonFile('deployment_config.json')
    const pre = await Preflight.create()

    const remainingPool = config.swapPools.find((pool) => !pool.address)
    if (!remainingPool) {
        console.log('All configured pools already have an address; nothing to do')
        return
    }
    console.log('Deploying pool:', remainingPool.tokenA, remainingPool.tokenB)

    const tokenAInfo = config.tokens[remainingPool.tokenA]
    const tokenBInfo = config.tokens[remainingPool.tokenB]
    const microTokenA = FixedMathBN(1).dividedBy(FixedMathBN(10).pow(tokenAInfo.decimals))
    const microTokenB = FixedMathBN(1).dividedBy(FixedMathBN(10).pow(tokenBInfo.decimals))
    console.log('Token A decimals:', tokenAInfo.decimals)
    console.log('Token B decimals:', tokenBInfo.decimals)

    const prices = await queryPrices(config.tokens)
    console.log('Token A price:', prices[remainingPool.tokenA])
    console.log('Token B price:', prices[remainingPool.tokenB])
    if (!prices[remainingPool.tokenA] || !prices[remainingPool.tokenB]) {
        throw new Error('Missing a token price; refusing to initialize a pool at an unknown price')
    }

    const weiTokenAUsd = microTokenA.multipliedBy(prices[remainingPool.tokenA])
    const weiTokenBUsd = microTokenB.multipliedBy(prices[remainingPool.tokenB])

    // How many wei of tokenB one wei of tokenA is worth.
    const ratio = weiTokenAUsd.dividedBy(weiTokenBUsd)
    console.log('Price-adjusted ratio:', ratio.toString())

    const oneUsdWorthOfTokenA = FixedMathBN(1).dividedBy(prices[remainingPool.tokenA])
    const oneUsdWorthOfTokenAInWei = oneUsdWorthOfTokenA.multipliedBy(FixedMathBN(10).pow(tokenAInfo.decimals))
    const equivalentTokenBInWei = oneUsdWorthOfTokenAInWei.multipliedBy(ratio)
    const equivalentTokenB = equivalentTokenBInWei.dividedBy(FixedMathBN(10).pow(tokenBInfo.decimals))
    const priceOfEquivalentTokenB = equivalentTokenB.multipliedBy(prices[remainingPool.tokenB])
    console.log('If I send 1 USD worth of token A, I will get', equivalentTokenB.toString(), 'of token B worth', priceOfEquivalentTokenB.toString())

    // The pool price is token1/token0 by address order; flip when tokenA sorts second.
    const token0IsA = tokenAInfo.address.toLowerCase() < tokenBInfo.address.toLowerCase()
    const initialRatio = token0IsA ? weiTokenAUsd.dividedBy(weiTokenBUsd) : weiTokenBUsd.dividedBy(weiTokenAUsd)
    const sqrtPriceX96 = encodePrice(initialRatio.toString())
    console.log('Initial sqrtPriceX96:', sqrtPriceX96)

    const answer = await askQuestion('Type "deploy" to create the pool with these parameters: ')
    if (answer.trim() !== 'deploy') {
        throw new Error('Aborted by operator')
    }

    const poolContract = await deployPool(
        pre,
        config.commonContracts.controller,
        config.commonContracts.factory,
        tokenAInfo.address,
        tokenBInfo.address,
        Math.round(config.fee * 1_000_000),
        config.protocolFeeFraction,
        TICK_SPACINGS[remainingPool.volatility],
        sqrtPriceX96
    )

    remainingPool.address = poolContract.address
    saveJsonFile('deployment_config.json', config)
    console.log('Deployment record:', pre.recordPath)
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error)
            process.exitCode = 1
        })
        .then(() => process.exit())
}
