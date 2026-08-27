// Runs the deploy/admin scripts end-to-end on the hardhat network so Controller/NFPM ABI drift
// (e.g. the 7-arg createPool that initializes inline) fails CI instead of a mainnet run.
import fs from 'fs'
import os from 'os'
import path from 'path'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { deployAll, encodePriceSqrt } from '../scripts/deploy'
import { Preflight, assertPeripheryInitCodeHash, readSourcePoolInitCodeHash } from '../scripts/main_scripts/preflight'
import { deployCommonContracts } from '../scripts/main_scripts/deploy_core'
import { deployPool, encodePrice } from '../scripts/main_scripts/deploy_next_pool'
import { deployQuoter } from '../scripts/main_scripts/deploy_quoter'
import { configureDiscountDefaults } from '../scripts/main_scripts/set_default_discount_fee_manager'

chai.use(chaiAsPromised)
const expect = chai.expect

const MONE = BigNumber.from(10).pow(18)

describe('deploy scripts (hardhat smoke)', function () {
    this.timeout(300000)
    let recordDir: string
    const savedEnv = { ...process.env }

    before(function () {
        recordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinuswap-deployments-'))
        process.env.VINUSWAP_DEPLOYMENTS_DIR = recordDir
        process.env.VINUSWAP_CONFIRM = 'yes'
        delete process.env.VINUSWAP_POOL_FEE_MANAGER
        delete process.env.VINUSWAP_DEFAULT_DISCOUNT
    })

    after(function () {
        process.env = savedEnv
        fs.rmSync(recordDir, { recursive: true, force: true })
    })

    it('scripts/deploy.ts deploys, creates + initializes a pool via Controller.createPool, mints, swaps and collects', async function () {
        // Park the deployer on a nonce whose next two CREATE addresses sort differently as
        // checksummed strings than numerically, so basicSetup's token0/token1 ordering is exercised
        // instead of passing by nonce luck (NFPM.mint reverts on token0 > token1).
        const [deployer] = await ethers.getSigners()
        const orderDisagrees = (a: string, b: string) => (a > b) !== (a.toLowerCase() > b.toLowerCase())
        for (let i = 0; i < 300; i++) {
            const nonce = await deployer.getTransactionCount()
            const [a, b] = [nonce, nonce + 1].map((n) => ethers.utils.getContractAddress({ from: deployer.address, nonce: n }))
            if (orderDisagrees(a, b)) break
            await deployer.sendTransaction({ to: deployer.address })
        }
        const d = await deployAll()
        const [token0, token1] = [d.token0Contract.address, d.token1Contract.address]
        expect(orderDisagrees(token0, token1), 'test pair must be one where checksummed and numeric order disagree').to.be.true
        expect(BigNumber.from(token0).lt(BigNumber.from(token1)), 'token0 < token1 numerically').to.be.true
        expect(await d.factoryContract.owner()).to.equal(d.controllerContract.address)
        expect(await d.controllerContract.defaultFeeManager(d.factoryContract.address)).to.equal(d.overridableFeeManagerContract.address)
        expect(await d.overridableFeeManagerContract.defaultFeeManager()).to.equal(d.noDiscountContract.address) // NoDiscount by default, like mainnet
        expect(await d.poolContract.feeManager()).to.equal(d.overridableFeeManagerContract.address)
        expect(await d.positionDescriptorContract.nativeCurrencyLabel()).to.equal('VC')
    })

    it('deploy_core -> deploy_next_pool -> deploy_quoter -> set_default_discount_fee_manager run against the current ABIs', async function () {
        const [deployer, payee] = await ethers.getSigners()
        const erc20 = await ethers.getContractFactory('MockERC20')
        const tokenA = await erc20.deploy()
        const tokenB = await erc20.deploy()
        const vinu = await erc20.deploy()
        const wvc = await (await ethers.getContractFactory('WETH9')).deploy()

        const pre = await Preflight.create()
        const core = await deployCommonContracts(
            pre,
            [payee.address],
            [1000],
            vinu.address,
            [MONE.mul(1000).toString()],
            ['500'],
            wvc.address,
            { '500': 10, '3000': 60, '10000': 200 }
        )
        const controller = await ethers.getContractAt('Controller', core.controller)
        const ofm = await ethers.getContractAt('OverridableFeeManager', core.overridableFeeManager)
        expect(await controller.defaultFeeManager(core.factory)).to.equal(core.overridableFeeManager)
        expect(await ofm.defaultFeeManager()).to.equal(core.noDiscount) // NoDiscount by default, like mainnet
        expect(await controller.defaultTickSpacing(core.factory, 3000)).to.equal(60)
        expect(await (await ethers.getContractAt('NonfungibleTokenPositionDescriptor', core.positionDescriptor)).nativeCurrencyLabel()).to.equal('VC')

        // deploy_next_pool: 7-arg createPool, no separate initialize, fee manager = Controller default
        const sqrtPriceX96 = encodePrice('2')
        const pool = await deployPool(pre, core.controller, core.factory, tokenA.address, tokenB.address, 3000, 5, 60, sqrtPriceX96)
        expect(await pool.feeManager()).to.equal(core.overridableFeeManager)
        expect((await pool.slot0()).sqrtPriceX96.toString()).to.equal(sqrtPriceX96)
        expect((await pool.slot0()).feeProtocol).to.equal(5 + (5 << 4))
        const factory = await ethers.getContractAt('VinuSwapFactory', core.factory)
        expect(await factory.getPool(tokenA.address, tokenB.address, 3000)).to.equal(pool.address)

        // a second deployPool for the same pair must fail in simulation (factory duplicate check), before any tx
        const mutationsBefore = pre.record.mutations.length
        await expect(deployPool(pre, core.controller, core.factory, tokenA.address, tokenB.address, 3000, 0, 60, sqrtPriceX96)).to.be.rejected
        expect(pre.record.mutations.length).to.equal(mutationsBefore)

        // an invalid protocol fee (pool accepts 0 or 4..10) is rejected before the irreversible createPool
        for (const bad of [2, 0.2]) {
            await expect(deployPool(pre, core.controller, core.factory, vinu.address, wvc.address, 3000, bad, 60, sqrtPriceX96)).to.be.rejectedWith(/protocolFeeFraction/)
        }
        expect(pre.record.mutations.length).to.equal(mutationsBefore)
        expect(await factory.getPool(vinu.address, wvc.address, 3000)).to.equal(ethers.constants.AddressZero)

        // deploy_quoter: init-code-hash guard now has a PoolCreated log to derive from
        const quoter = await deployQuoter(pre, core.factory, wvc.address)
        expect(await quoter.factory()).to.equal(core.factory)

        // set_default_discount_fee_manager: flips OverridableFeeManager default to TieredDiscount and asserts post-state
        await configureDiscountDefaults(pre, core.controller, core.factory, core.overridableFeeManager, core.tieredDiscount, true)
        expect(await ofm.defaultFeeManager()).to.equal(core.tieredDiscount)

        // JSON record: every deploy + mutation with tx hash and block
        const record = JSON.parse(fs.readFileSync(pre.recordPath, 'utf8'))
        expect(record.chainId).to.equal(31337)
        expect(record.signer).to.equal(deployer.address)
        expect(Object.keys(record.deployed)).to.include.members(['Controller', 'VinuSwapFactory', 'NonfungiblePositionManager', 'VinuSwapQuoter'])
        const createPoolRecord = record.mutations.find((m) => m.method === 'createPool')
        expect(createPoolRecord.before).to.equal(ethers.constants.AddressZero)
        expect(createPoolRecord.after).to.equal(pool.address)
        expect(createPoolRecord.txHash).to.match(/^0x[0-9a-f]{64}$/)
        expect(createPoolRecord.blockNumber).to.be.greaterThan(0)
        const flip = record.mutations.find((m) => m.label === 'OverridableFeeManager.setDefaultFeeManager')
        expect(flip.before).to.equal(core.noDiscount)
        expect(flip.after).to.equal(core.tieredDiscount)
    })

    it('refuses every mutation without VINUSWAP_CONFIRM and refuses a signer that is not the owner', async function () {
        const [, other] = await ethers.getSigners()
        const pre = await Preflight.create()
        const factory = await (await ethers.getContractFactory('VinuSwapFactory')).deploy()

        process.env.VINUSWAP_CONFIRM = ''
        await expect(
            pre.mutate({ label: 'setOwner', contract: factory, method: 'setOwner', args: [other.address], readState: () => factory.owner() })
        ).to.be.rejectedWith('VINUSWAP_CONFIRM')
        expect(await factory.owner()).to.not.equal(other.address)

        process.env.VINUSWAP_CONFIRM = factory.address // confirming the exact target is enough
        await pre.mutate({ label: 'setOwner', contract: factory, method: 'setOwner', args: [other.address], readState: () => factory.owner(), expectedAfter: other.address })
        process.env.VINUSWAP_CONFIRM = 'yes'

        const controller = await (await ethers.getContractFactory('Controller')).deploy([other.address], [1])
        await controller.transferOwnership(other.address)
        await expect(pre.assertOwner('Controller', controller)).to.be.rejectedWith('owner is')
    })

    it('init-code-hash guard refuses periphery whose embedded hash cannot reproduce the factory pools', async function () {
        const factory = await (await ethers.getContractFactory('VinuSwapFactory')).deploy()
        // Pool-less factory of unknown origin: refused unless provenance is proven.
        await expect(assertPeripheryInitCodeHash(factory.address)).to.be.rejectedWith('VINUSWAP_INIT_CODE_HASH')
        await assertPeripheryInitCodeHash(factory.address, { deployedFromArtifacts: true }) // same-run deployment
        process.env.VINUSWAP_INIT_CODE_HASH = readSourcePoolInitCodeHash()
        try {
            await assertPeripheryInitCodeHash(factory.address) // declared, matching hash
            process.env.VINUSWAP_INIT_CODE_HASH = '0x' + '11'.repeat(32)
            await expect(assertPeripheryInitCodeHash(factory.address)).to.be.rejectedWith('declares')
        } finally {
            delete process.env.VINUSWAP_INIT_CODE_HASH
        }

        const noDiscount = await (await ethers.getContractFactory('NoDiscount')).deploy()
        const erc20 = await ethers.getContractFactory('MockERC20')
        const a = await erc20.deploy()
        const b = await erc20.deploy()
        await factory.createPool(a.address, b.address, 3000, 60, noDiscount.address)
        await assertPeripheryInitCodeHash(factory.address) // derived from the PoolCreated log

        // A "factory" whose PoolCreated log names a pool the vendored hash cannot reproduce.
        const fake = await (await ethers.getContractFactory('FakeFactory')).deploy()
        await fake.emitPoolCreated(a.address, b.address, 3000, ethers.Wallet.createRandom().address)
        await expect(assertPeripheryInitCodeHash(fake.address)).to.be.rejectedWith('does not reproduce pool')

        // The live mainnet factory is pinned to 0xe8b8...; HEAD artifacts embed the local hash.
        await expect(assertPeripheryInitCodeHash('0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe')).to.be.rejectedWith('pinned to')
    })

    it('bytecode check accepts a matching artifact and rejects a mismatching one unless explicitly allowed', async function () {
        const pre = await Preflight.create()
        const noDiscount = await (await ethers.getContractFactory('NoDiscount')).deploy()
        await pre.assertCode('NoDiscount', noDiscount.address, 'NoDiscount')
        await expect(pre.assertCode('NoDiscount', noDiscount.address, 'HalfDiscount')).to.be.rejectedWith('does not match artifact')
        await expect(pre.assertCode('nothing', ethers.Wallet.createRandom().address)).to.be.rejectedWith('has no code')

        process.env.VINUSWAP_ALLOW_BYTECODE_MISMATCH = noDiscount.address
        await pre.assertCode('NoDiscount', noDiscount.address, 'HalfDiscount')
        delete process.env.VINUSWAP_ALLOW_BYTECODE_MISMATCH
    })

    it('encodePriceSqrt helpers agree between deploy.ts and deploy_next_pool.ts', function () {
        expect(encodePrice('2')).to.equal(encodePriceSqrt(BigNumber.from(2)).toString())
    })
})
