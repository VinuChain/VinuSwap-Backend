// Deploys the full VinuSwap core + periphery topology (see deployment_config.example.json).
// Fee policy matches the live deployment: Controller.defaultFeeManager -> OverridableFeeManager
// -> NoDiscount by default; VINUSWAP_DEFAULT_DISCOUNT=tiered routes the default to
// TieredDiscount instead.
import { ethers } from 'hardhat'
import { Preflight, assertPeripheryInitCodeHash, loadJsonFile, saveJsonFile } from './preflight'

export const NATIVE_CURRENCY_LABEL = 'VC'

export interface CoreAddresses {
    controller: string
    factory: string
    router: string
    positionDescriptor: string
    positionManager: string
    noDiscount: string
    tieredDiscount: string
    overridableFeeManager: string
    quoter: string
}

export async function deployCommonContracts(
    pre: Preflight,
    accounts: string[],
    shares: (string | number)[],
    discountToken: string,
    discountThresholds: string[],
    discounts: string[],
    WETH: string,
    defaultTickSpacings: Record<string, number> = {},
    tieredDefault: boolean = process.env.VINUSWAP_DEFAULT_DISCOUNT === 'tiered'
): Promise<CoreAddresses> {
    const controller = await pre.deploy('Controller', await ethers.getContractFactory('Controller'), [accounts, shares])
    const factory = await pre.deploy('VinuSwapFactory', await ethers.getContractFactory('VinuSwapFactory'))

    await pre.mutate({
        label: 'factory.setOwner -> Controller',
        contract: factory,
        method: 'setOwner',
        args: [controller.address],
        readState: () => factory.owner(),
        expectedAfter: controller.address,
    })

    // The factory was deployed from these artifacts a moment ago, so its pool creation code is known.
    await assertPeripheryInitCodeHash(factory.address, { deployedFromArtifacts: true })

    const router = await pre.deploy('SwapRouter', await ethers.getContractFactory('SwapRouter'), [factory.address, WETH])

    const nftDescriptorLibrary = await pre.deploy('NFTDescriptor', await ethers.getContractFactory('NFTDescriptor'))
    const positionDescriptor = await pre.deploy(
        'NonfungibleTokenPositionDescriptor',
        await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
            libraries: { NFTDescriptor: nftDescriptorLibrary.address },
        }),
        [WETH, ethers.utils.formatBytes32String(NATIVE_CURRENCY_LABEL)]
    )
    const positionManager = await pre.deploy(
        'NonfungiblePositionManager',
        await ethers.getContractFactory('NonfungiblePositionManager'),
        [factory.address, WETH, positionDescriptor.address]
    )

    const noDiscount = await pre.deploy('NoDiscount', await ethers.getContractFactory('NoDiscount'))
    const tieredDiscount = await pre.deploy('TieredDiscount', await ethers.getContractFactory('TieredDiscount'), [
        discountToken,
        discountThresholds,
        discounts,
    ])
    const overridableFeeManager = await pre.deploy(
        'OverridableFeeManager',
        await ethers.getContractFactory('OverridableFeeManager'),
        [tieredDefault ? tieredDiscount.address : noDiscount.address]
    )

    await pre.mutate({
        label: 'controller.setDefaultFeeManager -> OverridableFeeManager',
        contract: controller,
        method: 'setDefaultFeeManager',
        args: [factory.address, overridableFeeManager.address],
        readState: () => controller.defaultFeeManager(factory.address),
        expectedAfter: overridableFeeManager.address,
    })

    for (const [fee, tickSpacing] of Object.entries(defaultTickSpacings)) {
        await pre.mutate({
            label: `controller.setDefaultTickSpacing fee ${fee}`,
            contract: controller,
            method: 'setDefaultTickSpacing',
            args: [factory.address, Number(fee), tickSpacing],
            readState: () => controller.defaultTickSpacing(factory.address, Number(fee)),
            expectedAfter: tickSpacing,
        })
    }

    const quoter = await pre.deploy('VinuSwapQuoter', await ethers.getContractFactory('VinuSwapQuoter'), [factory.address, WETH])

    return {
        controller: controller.address,
        factory: factory.address,
        router: router.address,
        positionDescriptor: positionDescriptor.address,
        positionManager: positionManager.address,
        noDiscount: noDiscount.address,
        tieredDiscount: tieredDiscount.address,
        overridableFeeManager: overridableFeeManager.address,
        quoter: quoter.address,
    }
}

export function parseLetterNumber(str: string): string {
    return str.replace('k', '000').replace('M', '000000').replace('B', '000000000').replace('T', '000000000000')
}

async function main() {
    const config = loadJsonFile('deployment_config.json')
    const pre = await Preflight.create()

    const controllerAccounts = config.controllers.map((pair) => pair[0])
    const controllerShares = config.controllers.map((pair) => pair[1])
    const discountTokenInfo = config.tokens[config.discountToken]
    const discountThresholds = config.discounts.map((pair) =>
        ethers.utils.parseUnits(parseLetterNumber(pair[0]), discountTokenInfo.decimals).toString()
    )
    const discounts = config.discounts.map((pair) => Math.round(pair[1] * 10000).toString())

    console.log('Controller accounts:', controllerAccounts)
    console.log('Controller shares:', controllerShares)
    console.log('Discount thresholds:', discountThresholds)
    console.log('Discounts (bps):', discounts)

    config.commonContracts = await deployCommonContracts(
        pre,
        controllerAccounts,
        controllerShares,
        discountTokenInfo.address,
        discountThresholds,
        discounts,
        config.tokens.wvc.address,
        config.defaultTickSpacings || {}
    )

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
