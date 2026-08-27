// Regression tests for the VinuSwap-specific deltas vs Uniswap V3 (fee managers, tx.origin
// discounts, position locks, owner-gated factory/pool, QuoterV2 multi-hop, flash removal,
// EIP-170 headroom, live init-code-hash derivation, descriptor label).
import fs from 'fs'
import path from 'path'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import hre, { ethers } from 'hardhat'
import { BigNumber, constants } from 'ethers'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { encodePath } from './periphery/shared/path'
import { encodePriceSqrt } from './periphery/shared/encodePriceSqrt'
import { extractJSONFromURI } from './periphery/shared/extractJSONFromURI'

hre.tracer.enabled = false
chai.use(chaiAsPromised)
const expect = chai.expect

const MONE = BigNumber.from(10).pow(18)
const MAX_UINT128 = BigNumber.from(2).pow(128).sub(1)
const FEE = 100000 // 10%, so LP fee amounts are easy to read
const TICK_SPACING = 1
const MIN_TICK = -887272
const MAX_TICK = 887272
const EIP170_LIMIT = 24576

// VinuChain mainnet (chainId 207) truth, verified by read-only eth_call in the audit.
const LIVE = {
    factory: '0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe',
    initCodeHash: '0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e',
    usdt: '0xc0264277fcca5fcfabd41a8bc01c1fcaf8383e41',
    wvc: '0xed8c5530a0a086a12f57275728128a60dff04230',
    wvcUsdtPool: '0x2f50d5E141A5B9F148187008DE4795A4Be407112',
}

const deadline = async () => (await time.latest()) + 1000

async function deployStack() {
    const [deployer, alice, bob, carol] = await ethers.getSigners()
    const erc20 = await ethers.getContractFactory('MockERC20')
    const tokens = [await erc20.deploy(), await erc20.deploy(), await erc20.deploy()]
    tokens.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
    for (const token of tokens) {
        await token.mint(MONE.mul(1_000_000))
    }
    const weth9 = await (await ethers.getContractFactory('WETH9')).deploy()
    const factory = await (await ethers.getContractFactory('VinuSwapFactory')).deploy()
    const noDiscount = await (await ethers.getContractFactory('NoDiscount')).deploy()
    const router = await (await ethers.getContractFactory('SwapRouter')).deploy(factory.address, weth9.address)
    const nftDescriptorLibrary = await (await ethers.getContractFactory('NFTDescriptor')).deploy()
    const descriptor = await (
        await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
            libraries: { NFTDescriptor: nftDescriptorLibrary.address },
        })
    ).deploy(weth9.address, ethers.utils.formatBytes32String('VC'))
    const nft = await (await ethers.getContractFactory('NonfungiblePositionManager')).deploy(
        factory.address,
        weth9.address,
        descriptor.address
    )
    const quoter = await (await ethers.getContractFactory('VinuSwapQuoter')).deploy(factory.address, weth9.address)
    const poolBlueprint = await ethers.getContractFactory('VinuSwapPool')

    // Creates + initializes a pool at price token1/token0 = 1 (factory owner = deployer).
    const createPool = async (tokenA, tokenB, feeManager: string, fee = FEE, tickSpacing = TICK_SPACING, sqrtPrice = encodePriceSqrt(1, 1)) => {
        const tx = await factory.createPool(tokenA.address, tokenB.address, fee, tickSpacing, feeManager)
        const pool = poolBlueprint.attach((await tx.wait()).events[0].args.pool)
        await pool.initialize(sqrtPrice)
        return pool
    }

    const mint = async (signer, tokenA, tokenB, amount0 = MONE.mul(1000), amount1 = MONE.mul(1000), fee = FEE, tickLower = MIN_TICK, tickUpper = MAX_TICK) => {
        const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
        await token0.connect(signer).approve(nft.address, amount0)
        await token1.connect(signer).approve(nft.address, amount1)
        const tx = await nft.connect(signer).mint({
            token0: token0.address,
            token1: token1.address,
            fee,
            tickLower,
            tickUpper,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: signer.address,
            deadline: await deadline(),
        })
        const receipt = await tx.wait()
        return receipt.events.find((e) => e.event === 'IncreaseLiquidity').args.tokenId
    }

    const swapExactInputSingle = async (signer, tokenIn, tokenOut, amountIn = MONE, fee = FEE) => {
        await tokenIn.connect(signer).approve(router.address, amountIn)
        return router.connect(signer).exactInputSingle({
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            fee,
            recipient: signer.address,
            deadline: await deadline(),
            amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
        })
    }

    const collect = async (signer, tokenId, recipient = signer.address) => {
        const token0Before = await tokens[0].balanceOf(recipient)
        const token1Before = await tokens[1].balanceOf(recipient)
        await nft.connect(signer).collect({ tokenId, recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 })
        return [
            (await tokens[0].balanceOf(recipient)).sub(token0Before),
            (await tokens[1].balanceOf(recipient)).sub(token1Before),
        ]
    }

    return { deployer, alice, bob, carol, tokens, weth9, factory, noDiscount, router, descriptor, nft, quoter, poolBlueprint, createPool, mint, swapExactInputSingle, collect }
}

type Stack = Awaited<ReturnType<typeof deployStack>>

describe('VinuSwap deltas vs Uniswap V3', function () {
    this.timeout(120000)
    let s: Stack

    beforeEach(async function () {
        s = await deployStack()
    })

    describe('fee manager failure modes', function () {
        it('a reverting fee manager halts swaps but not mint, decreaseLiquidity or collect', async function () {
            const revertingFee = await (await ethers.getContractFactory('RevertingFee')).deploy()
            await s.createPool(s.tokens[0], s.tokens[1], revertingFee.address)
            await s.tokens[0].transfer(s.alice.address, MONE)

            const tokenId = await s.mint(s.deployer, s.tokens[0], s.tokens[1])
            await expect(s.swapExactInputSingle(s.alice, s.tokens[0], s.tokens[1])).to.be.rejectedWith('RevertingFee')

            const { liquidity } = await s.nft.positions(tokenId)
            await s.nft.decreaseLiquidity({ tokenId, liquidity, amount0Min: 0, amount1Min: 0, deadline: await deadline() })
            const [amount0, amount1] = await s.collect(s.deployer, tokenId)
            expect(amount0.gt(0) && amount1.gt(0), 'LP exit returns principal').to.be.true
        })

        it('a pool created with feeManager == address(0) accepts liquidity but cannot swap', async function () {
            const pool = await s.createPool(s.tokens[0], s.tokens[1], constants.AddressZero)
            expect(await pool.feeManager()).to.equal(constants.AddressZero)
            await s.tokens[0].transfer(s.alice.address, MONE)

            await s.mint(s.deployer, s.tokens[0], s.tokens[1])
            await expect(s.swapExactInputSingle(s.alice, s.tokens[0], s.tokens[1])).to.be.rejected
        })

        it('OverridableFeeManager reverts computeFee while its default fee manager is unset', async function () {
            const ofm = await (await ethers.getContractFactory('OverridableFeeManager')).deploy(constants.AddressZero)
            await expect(ofm.callStatic.computeFee(FEE)).to.be.rejected

            await ofm.setDefaultFeeManager(s.noDiscount.address)
            expect(await ofm.callStatic.computeFee(FEE)).to.equal(FEE)
        })
    })

    describe('TieredDiscount follows tx.origin through router -> pool -> OverridableFeeManager', function () {
        let discountToken, tieredDiscount, ofm, swapCaller

        beforeEach(async function () {
            discountToken = await (await ethers.getContractFactory('MockERC20')).deploy()
            tieredDiscount = await (await ethers.getContractFactory('TieredDiscount')).deploy(discountToken.address, [100], [5000])
            ofm = await (await ethers.getContractFactory('OverridableFeeManager')).deploy(tieredDiscount.address)
            swapCaller = await (await ethers.getContractFactory('SwapCaller')).deploy()
            await s.createPool(s.tokens[0], s.tokens[1], ofm.address)
            await s.mint(s.deployer, s.tokens[0], s.tokens[1])
        })

        it('discounts an EOA that holds the discount token', async function () {
            await discountToken.connect(s.alice).mint(100)
            await s.tokens[0].transfer(s.alice.address, MONE)
            await s.swapExactInputSingle(s.alice, s.tokens[0], s.tokens[1])

            const [fee0] = await s.collect(s.deployer, 1)
            expect(fee0.toString()).to.equal('49999999999999999') // 10% fee halved, minus rounding
        })

        it('gives no discount when only the calling contract (msg.sender) holds the discount token', async function () {
            await discountToken.mint(100)
            await discountToken.transfer(swapCaller.address, 100)
            await s.tokens[0].transfer(swapCaller.address, MONE)
            await swapCaller.connect(s.alice).swap(s.router.address, {
                tokenIn: s.tokens[0].address,
                tokenOut: s.tokens[1].address,
                fee: FEE,
                recipient: s.alice.address,
                deadline: await deadline(),
                amountIn: MONE,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0,
            })

            const [fee0] = await s.collect(s.deployer, 1)
            expect(fee0.toString()).to.equal('99999999999999999') // full 10% fee: tx.origin (alice) holds nothing
        })
    })

    describe('position locking and transfers', function () {
        it('lock travels with the token: the new owner cannot decreaseLiquidity but can collect', async function () {
            await s.createPool(s.tokens[0], s.tokens[1], s.noDiscount.address)
            await s.tokens[0].transfer(s.alice.address, MONE.mul(2000))
            await s.tokens[1].transfer(s.alice.address, MONE.mul(2000))
            await s.tokens[0].transfer(s.carol.address, MONE)

            const tokenId = await s.mint(s.alice, s.tokens[0], s.tokens[1])
            const lockedUntil = (await time.latest()) + 7 * 24 * 3600
            await s.nft.connect(s.alice).lock(tokenId, lockedUntil, await deadline())
            await s.swapExactInputSingle(s.carol, s.tokens[0], s.tokens[1])

            await s.nft.connect(s.alice).transferFrom(s.alice.address, s.bob.address, tokenId)
            expect(await s.nft.ownerOf(tokenId)).to.equal(s.bob.address)
            expect((await s.nft.positions(tokenId)).lockedUntil).to.equal(lockedUntil)

            const { liquidity } = await s.nft.positions(tokenId)
            await expect(
                s.nft.connect(s.bob).decreaseLiquidity({ tokenId, liquidity, amount0Min: 0, amount1Min: 0, deadline: await deadline() })
            ).to.be.rejectedWith('Locked')

            const [fee0] = await s.collect(s.bob, tokenId)
            expect(fee0.gt(0), 'new owner collects accrued fees while locked').to.be.true

            await time.increaseTo(lockedUntil)
            await s.nft.connect(s.bob).decreaseLiquidity({ tokenId, liquidity, amount0Min: 0, amount1Min: 0, deadline: await deadline() })
        })
    })

    describe('factory and pool access control', function () {
        it('rejects a duplicate (token0, token1, fee) pool in either token order', async function () {
            await s.createPool(s.tokens[0], s.tokens[1], s.noDiscount.address)
            await expect(
                s.factory.createPool(s.tokens[0].address, s.tokens[1].address, FEE, TICK_SPACING, s.noDiscount.address)
            ).to.be.rejected
            await expect(
                s.factory.createPool(s.tokens[1].address, s.tokens[0].address, FEE, TICK_SPACING, s.noDiscount.address)
            ).to.be.rejected
            // a different fee is a different pool
            await s.factory.createPool(s.tokens[0].address, s.tokens[1].address, FEE + 1, TICK_SPACING, s.noDiscount.address)
        })

        it('rejects pool.initialize from a non-factory-owner', async function () {
            const tx = await s.factory.createPool(s.tokens[0].address, s.tokens[1].address, FEE, TICK_SPACING, s.noDiscount.address)
            const pool = s.poolBlueprint.attach((await tx.wait()).events[0].args.pool)

            await expect(pool.connect(s.alice).initialize(encodePriceSqrt(1, 1))).to.be.rejected
            expect((await pool.slot0()).sqrtPriceX96).to.equal(0)

            await pool.initialize(encodePriceSqrt(1, 1)) // factory owner
            await expect(pool.initialize(encodePriceSqrt(1, 1))).to.be.rejectedWith('AI')
        })
    })

    describe('quoter (IQuoterV2) multi-hop', function () {
        beforeEach(async function () {
            await s.createPool(s.tokens[0], s.tokens[1], s.noDiscount.address)
            await s.createPool(s.tokens[1], s.tokens[2], s.noDiscount.address)
            await s.mint(s.deployer, s.tokens[0], s.tokens[1])
            await s.mint(s.deployer, s.tokens[1], s.tokens[2])
            await s.tokens[0].transfer(s.alice.address, MONE.mul(10))
            await s.tokens[0].connect(s.alice).approve(s.router.address, MONE.mul(10))
        })

        it('2-hop quoteExactInput equals router exactInput execution', async function () {
            const pathIn = encodePath([s.tokens[0].address, s.tokens[1].address, s.tokens[2].address], [FEE, FEE])
            const { amountOut } = await s.quoter.callStatic.quoteExactInput(pathIn, MONE)
            expect(amountOut.gt(0)).to.be.true

            const before = await s.tokens[2].balanceOf(s.alice.address)
            await s.router.connect(s.alice).exactInput({ path: pathIn, recipient: s.alice.address, deadline: await deadline(), amountIn: MONE, amountOutMinimum: 0 })
            expect((await s.tokens[2].balanceOf(s.alice.address)).sub(before)).to.equal(amountOut)
        })

        it('2-hop quoteExactOutput equals router exactOutput execution', async function () {
            // exact-output paths are encoded from tokenOut back to tokenIn
            const pathOut = encodePath([s.tokens[2].address, s.tokens[1].address, s.tokens[0].address], [FEE, FEE])
            const wanted = MONE.div(2)
            const { amountIn } = await s.quoter.callStatic.quoteExactOutput(pathOut, wanted)
            expect(amountIn.gt(wanted)).to.be.true

            const before0 = await s.tokens[0].balanceOf(s.alice.address)
            const before2 = await s.tokens[2].balanceOf(s.alice.address)
            await s.router.connect(s.alice).exactOutput({ path: pathOut, recipient: s.alice.address, deadline: await deadline(), amountOut: wanted, amountInMaximum: MONE.mul(10) })
            expect(before0.sub(await s.tokens[0].balanceOf(s.alice.address))).to.equal(amountIn)
            expect((await s.tokens[2].balanceOf(s.alice.address)).sub(before2)).to.equal(wanted)
        })
    })

    describe('artifacts', function () {
        const artifactsRoot = path.resolve(__dirname, '../artifacts/contracts')
        const listArtifacts = (dir: string): string[] =>
            fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) return listArtifacts(full)
                return entry.name.endsWith('.json') && !entry.name.endsWith('.dbg.json') ? [full] : []
            })

        it('VinuSwapPool has no flash() in its ABI or bytecode', async function () {
            const artifact = await hre.artifacts.readArtifact('VinuSwapPool')
            expect(artifact.abi.some((item) => item.name === 'flash')).to.be.false
            const selector = ethers.utils.id('flash(address,uint256,uint256,bytes)').slice(2, 10)
            expect(artifact.deployedBytecode.toLowerCase()).to.not.include('63' + selector) // PUSH4 <selector>
            expect(artifact.deployedBytecode.toLowerCase()).to.not.include(selector)
        })

        it('every deployable non-test artifact fits EIP-170 (24576 bytes)', function () {
            const oversized: string[] = []
            let checked = 0
            for (const file of listArtifacts(artifactsRoot)) {
                if (file.includes(`${path.sep}contracts${path.sep}test${path.sep}`)) continue
                const { deployedBytecode } = JSON.parse(fs.readFileSync(file, 'utf8'))
                const size = (deployedBytecode.length - 2) / 2
                if (size === 0) continue // interfaces / abstract contracts / libraries with no code
                checked++
                if (size > EIP170_LIMIT) oversized.push(`${path.relative(artifactsRoot, file)}: ${size}`)
            }
            expect(checked).to.be.greaterThan(10)
            expect(oversized, 'artifacts over the EIP-170 limit').to.deep.equal([])
        })

        it('derives the live WVC/USDT pool from the live factory + init code hash (pure CREATE2, no RPC)', function () {
            const [token0, token1] = LIVE.usdt < LIVE.wvc ? [LIVE.usdt, LIVE.wvc] : [LIVE.wvc, LIVE.usdt]
            const salt = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint24'], [token0, token1, 3000]))
            expect(ethers.utils.getCreate2Address(LIVE.factory, salt, LIVE.initCodeHash)).to.equal(LIVE.wvcUsdtPool)

            // The local build's hash is a different value and must NOT reproduce the live pool.
            const source = fs.readFileSync(path.resolve(__dirname, '../contracts/periphery/libraries/PoolAddress.sol'), 'utf8')
            const localHash = source.match(/POOL_INIT_CODE_HASH\s*=\s*(0x[0-9a-fA-F]{64})/)![1]
            expect(ethers.utils.getCreate2Address(LIVE.factory, salt, localHash)).to.not.equal(LIVE.wvcUsdtPool)
        })
    })

    describe('descriptor', function () {
        it("labels the native currency 'VC' when deployed with the script parameters", async function () {
            expect(await s.descriptor.nativeCurrencyLabel()).to.equal('VC')
        })

        // Live WVC/USDT pool 0x2f50...7112: USDT (6 dec) is token0, WVC is token1, 1 USDT ~ 3186 WVC.
        async function liveLikeUsdtWvcPool() {
            let usdt
            for (let i = 0; i < 32 && !usdt; i++) {
                const candidate = await (await ethers.getContractFactory('MockERC20Decimals')).deploy('USDT@VinuChain', 'USDT', 6)
                if (candidate.address.toLowerCase() < s.weth9.address.toLowerCase()) usdt = candidate
            }
            expect(usdt, 'a 6-decimal token sorting before WETH9').to.not.be.undefined
            await usdt.mint(BigNumber.from(10).pow(6).mul(1_000_000))
            await s.weth9.deposit({ value: ethers.utils.parseEther('100') })
            const pool = await s.createPool(usdt, s.weth9, s.noDiscount.address, 3000, 60, encodePriceSqrt(MONE.mul(3186), BigNumber.from(10).pow(6)))
            expect(await pool.token0()).to.equal(usdt.address)
            return usdt
        }

        it('renders tokenURI for a full-range 6-decimal / 18-decimal (WVC) position at the live WVC/USDT price', async function () {
            const usdt = await liveLikeUsdtWvcPool()
            const tokenId = await s.mint(s.deployer, usdt, s.weth9, BigNumber.from(10).pow(6).mul(100), MONE.mul(10), 3000, -887220, 887220)

            const metadata = extractJSONFromURI(await s.nft.tokenURI(tokenId))
            expect(metadata.name).to.include('USDT')
            expect(metadata.name).to.include('VC')
        })

        // Documents the live defect: NFPM.tokenURI(1)/(3) on mainnet revert for USDT/WVC positions with
        // ticks -703080..710040. Reproduced here on HEAD: the revert (empty data) comes from the upstream
        // NFTDescriptor.fixedPointToDecimalString when the lower tick's decimal-adjusted price is too small
        // (MIN_TICK is special-cased, so full-range positions render). Not a VinuSwap delta; immutable on
        // the live descriptor.
        it('tokenURI reverts with empty data for the live USDT/WVC tick range (-703080..710040) on HEAD too', async function () {
            const usdt = await liveLikeUsdtWvcPool()
            const tokenId = await s.mint(s.deployer, usdt, s.weth9, BigNumber.from(10).pow(6).mul(100), MONE.mul(10), 3000, -703080, 710040)

            const error = await s.nft.tokenURI(tokenId, { gasLimit: 30_000_000 }).then(
                () => undefined,
                (e) => e
            )
            expect(error, 'tokenURI should revert').to.not.be.undefined
            expect(error.code).to.equal('CALL_EXCEPTION')
            expect(error.data).to.equal('0x')
        })
    })
})
