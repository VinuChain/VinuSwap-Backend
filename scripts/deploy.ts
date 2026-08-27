// Local end-to-end rehearsal: deploys the full topology on the hardhat network, creates and
// initializes a pool via Controller.createPool, mints, swaps and collects. Exercised by
// test/scripts.spec.ts so Controller/NFPM ABI drift fails CI.
import { BigNumber } from "@ethersproject/bignumber"
import hre from 'hardhat'
import { ethers } from "hardhat"
import bn from 'bignumber.js'
import { expect } from "chai"

const MONE = BigNumber.from('1000000000000000000') //10**18

export const FEE = 2500 // 0.25%
export const TICK_SPACING = 2
export const PROTOCOL_FEE = 5 // Corresponding to 20% of the entire fee (20% of 0.25% = 0.05%). The rest (0.20%) goes to LPs
export const SHARES = [1, 2, 2] // DAO treasury: 0.01%, $VINU Buy & Burns: 0.02%, $VINUCHAIN Buy & Burns: 0.02%
export const NATIVE_CURRENCY_LABEL = 'VC'

// Example thresholds and discounts
// Keep in mind that VinuSwap fees are in hundredths of a bip (1/1e6), while
// the discounts are in basis points (1/1e4)
export const THRESHOLDS = [MONE.mul(1000), MONE.mul(10000), MONE.mul(100000), MONE.mul(1000000)]
// 1%, 2%, 3%, 4%
export const DISCOUNTS = [100, 200, 300, 400]

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })
export function encodePriceSqrt(ratio : BigNumber){
  return BigNumber.from(
    new bn(ratio.toString()).sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  )
}

async function chainDeadline() {
    return (await ethers.provider.getBlock('latest')).timestamp + 1000000
}

export interface Deployment {
    deployer: any
    token0Contract: any
    token1Contract: any
    discountTokenContract: any
    weth9Contract: any
    controllerContract: any
    factoryContract: any
    routerContract: any
    positionDescriptorContract: any
    positionManagerContract: any
    noDiscountContract: any
    tieredDiscountContract: any
    overridableFeeManagerContract: any
    poolContract?: any
}

export async function basicSetup(useMockErc20s : boolean) {
    const [deployer] = await ethers.getSigners()

    const erc20ContractName = useMockErc20s ? 'MockERC20' : 'ERC20'
    const erc20Blueprint = await hre.ethers.getContractFactory(erc20ContractName)

    let token0Contract = await erc20Blueprint.deploy()
    let token1Contract = await erc20Blueprint.deploy()

    // token0 is always the one with the lower address. Compare lowercased: Contract.address is
    // EIP-55 mixed case and string order of 'A'-'F' vs 'a'-'f' disagrees with numeric order.
    if (token0Contract.address.toLowerCase() > token1Contract.address.toLowerCase()) {
        [token0Contract, token1Contract] = [token1Contract, token0Contract]
    }
    expect(token0Contract.address.toLowerCase() < token1Contract.address.toLowerCase(), 'token0 < token1').to.be.true

    await token0Contract.connect(deployer).mint(MONE.mul(MONE))
    await token1Contract.connect(deployer).mint(MONE.mul(MONE))

    const discountTokenContract = await erc20Blueprint.deploy()

    const weth9Blueprint = await hre.ethers.getContractFactory('WETH9')
    const weth9Contract = await weth9Blueprint.deploy()

    console.log('Finished basic setup.')
    return { deployer, token0Contract, token1Contract, discountTokenContract, weth9Contract }
}

export async function deployCommonContracts(accounts, shares, discountToken : string, discountThresholds, discounts, WETH : string) {
    const [deployer] = await ethers.getSigners()

    // 1. Deploy Controller
    const controllerContract = await (await hre.ethers.getContractFactory('Controller')).deploy(accounts, shares)

    // 2. Deploy VinuSwapFactory
    const factoryContract = await (await hre.ethers.getContractFactory('VinuSwapFactory')).deploy()

    // 3. Transfer ownership of VinuSwapFactory to Controller
    await factoryContract.connect(deployer).setOwner(controllerContract.address)

    // 4. Deploy SwapRouter
    const routerContract = await (await hre.ethers.getContractFactory('SwapRouter')).deploy(factoryContract.address, WETH)

    // 5. Deploy NFTDescriptor library + NonfungibleTokenPositionDescriptor
    const nftDescriptorLibraryContract = await (await hre.ethers.getContractFactory('NFTDescriptor')).deploy()
    const positionDescriptorBlueprint = await hre.ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
        libraries: {
            NFTDescriptor: nftDescriptorLibraryContract.address
        }
    })
    const positionDescriptorContract = await positionDescriptorBlueprint.deploy(
        WETH,
        hre.ethers.utils.formatBytes32String(NATIVE_CURRENCY_LABEL)
    )

    // 6. Deploy NonfungiblePositionManager
    const positionManagerContract = await (await hre.ethers.getContractFactory('NonfungiblePositionManager')).deploy(
        factoryContract.address,
        WETH,
        positionDescriptorContract.address
    )

    // 7. Fee policy: NoDiscount + TieredDiscount behind OverridableFeeManager (live topology)
    const noDiscountContract = await (await hre.ethers.getContractFactory('NoDiscount')).deploy()
    const tieredDiscountContract = await (await hre.ethers.getContractFactory('TieredDiscount')).deploy(
        discountToken,
        discountThresholds,
        discounts
    )
    // Live topology: the OverridableFeeManager routes to NoDiscount by default; tiered
    // discounts are an explicit opt-in (VINUSWAP_DEFAULT_DISCOUNT=tiered), as in deploy_core.ts.
    const tieredDefault = process.env.VINUSWAP_DEFAULT_DISCOUNT === 'tiered'
    const overridableFeeManagerContract = await (await hre.ethers.getContractFactory('OverridableFeeManager')).deploy(
        tieredDefault ? tieredDiscountContract.address : noDiscountContract.address
    )
    await controllerContract.connect(deployer).setDefaultFeeManager(factoryContract.address, overridableFeeManagerContract.address)

    console.log('Deployed common contracts.')
    return {
        controllerContract,
        factoryContract,
        routerContract,
        positionDescriptorContract,
        positionManagerContract,
        noDiscountContract,
        tieredDiscountContract,
        overridableFeeManagerContract,
    }
}

export async function deployPool (d : Deployment, fee, tickSpacing, feeManagerAddress : string, initialPrice) {
    // Controller.createPool creates AND initializes; a separate initialize() would revert 'AI'.
    const tx = await d.controllerContract.createPool(
        d.factoryContract.address, d.token0Contract.address, d.token1Contract.address, fee, tickSpacing, feeManagerAddress, initialPrice
    )
    const created = (await tx.wait()).events.find(e => e.event === 'PoolCreated')
    expect(created, 'Controller PoolCreated event').to.not.be.undefined

    const poolContract = (await hre.ethers.getContractFactory('VinuSwapPool')).attach(created.args.pool)
    expect((await poolContract.slot0()).sqrtPriceX96.toString()).to.equal(initialPrice.toString())

    await d.controllerContract.setFeeProtocol(poolContract.address, PROTOCOL_FEE, PROTOCOL_FEE)

    console.log('Deployed pool.')
    return poolContract
}

export async function testContract (d : Deployment, minter, swapper, fee, controllerPayees) {
    // 1. Mint a position, 2. swap, 3. collect LP fees, 4. collect protocol fees
    const { token0Contract, token1Contract, positionManagerContract, routerContract, controllerContract, poolContract, deployer } = d

    const minterInitialToken0Balance = await token0Contract.balanceOf(minter.address)
    const swapperInitialToken1Balance = await token1Contract.balanceOf(swapper.address)

    const mintParams = {
        token0 : token0Contract.address,
        token1 : token1Contract.address,
        fee,
        tickLower : -887272,
        tickUpper : 887272,
        amount0Desired : MONE.mul(1000),
        amount1Desired : MONE.mul(2000),
        amount0Min : 0,
        amount1Min : 0,
        recipient : minter.address,
        deadline : await chainDeadline()
    }

    await token0Contract.connect(minter).approve(positionManagerContract.address, MONE.mul(1000))
    await token1Contract.connect(minter).approve(positionManagerContract.address, MONE.mul(3000))
    await positionManagerContract.connect(minter).mint(mintParams)

    const minterIntermediateToken0Balance = await token0Contract.balanceOf(minter.address)
    expect(minterIntermediateToken0Balance.lt(minterInitialToken0Balance), 'mint pulled token0').to.be.true

    await token0Contract.connect(swapper).approve(routerContract.address, MONE)

    const swapParams = {
        tokenIn : token0Contract.address,
        tokenOut : token1Contract.address,
        fee,
        recipient : swapper.address,
        deadline : await chainDeadline(),
        amountIn : MONE,
        amountOutMinimum : 0,
        sqrtPriceLimitX96 : 0
    }

    await routerContract.connect(swapper).exactInputSingle(swapParams)
    expect((await token1Contract.balanceOf(swapper.address)).gt(swapperInitialToken1Balance), 'swap paid token1').to.be.true

    const UINT128_MAX = BigNumber.from(2).pow(128).sub(1)

    const collectParams = {
        tokenId : 1,
        recipient : deployer.address,
        amount0Max : UINT128_MAX,
        amount1Max : UINT128_MAX
    }
    await positionManagerContract.connect(minter).collect(collectParams)

    await controllerContract.connect(deployer).collectProtocolFees(poolContract.address, UINT128_MAX, UINT128_MAX)

    const payeeBalances : BigNumber[] = []
    for (const payee of controllerPayees) {
        payeeBalances.push(await controllerContract.balanceOf(payee, token0Contract.address))
    }
    expect(payeeBalances.some(b => b.gt(0)), 'protocol fees distributed').to.be.true

    console.log('Tested contracts.')
    return payeeBalances
}

export async function deployAll() : Promise<Deployment> {
    const [, alice, bob, charlie, dan] = await ethers.getSigners()
    const payeeAddresses = [alice.address, bob.address, charlie.address]

    const setup = await basicSetup(true)
    const common = await deployCommonContracts(
        payeeAddresses, SHARES, setup.discountTokenContract.address, THRESHOLDS, DISCOUNTS, setup.weth9Contract.address
    )
    const d : Deployment = { ...setup, ...common }
    d.poolContract = await deployPool(d, FEE, TICK_SPACING, common.overridableFeeManagerContract.address, encodePriceSqrt(BigNumber.from(2)))
    await setup.token0Contract.connect(setup.deployer).transfer(dan.address, MONE)
    await testContract(d, setup.deployer, dan, FEE, payeeAddresses)
    return d
}

if (require.main === module) {
    deployAll().then(() => console.log('Done.')).catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
}
