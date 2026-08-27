// Points OverridableFeeManager.defaultFeeManager at TieredDiscount (and, by default, the
// Controller's factory default at OverridableFeeManager). Every write is simulated, printed
// before/after, gated on VINUSWAP_CONFIRM and asserted after confirmation (see preflight.ts).
import { ethers } from 'hardhat'
import { Preflight } from './preflight'

const DEFAULT_CONTROLLER_ADDRESS = "0x47fF80713b1d66DdA47237AB374F3080E2075528"
const DEFAULT_FACTORY_ADDRESS = "0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe"
const DEFAULT_OVERRIDABLE_FEE_MANAGER_ADDRESS = "0xA15770c5692646667c195446996e1fE9D210374c"
const DEFAULT_TIERED_DISCOUNT_ADDRESS = "0x58818859dD0179498c530f549270F40fEB48579E"

function envAddress(name: string, fallback: string) {
    return ethers.utils.getAddress(process.env[name] || fallback)
}

function envFlag(name: string, fallback: boolean) {
    const value = process.env[name]
    if (value === undefined || value === "") {
        return fallback
    }

    return !["0", "false", "no", "off"].includes(value.toLowerCase())
}

export async function configureDiscountDefaults(
    pre: Preflight,
    controllerAddress: string,
    factoryAddress: string,
    overridableFeeManagerAddress: string,
    tieredDiscountAddress: string,
    setControllerDefault: boolean
) {
    console.log("Controller:", controllerAddress)
    console.log("Factory:", factoryAddress)
    console.log("Overridable fee manager:", overridableFeeManagerAddress)
    console.log("Tiered discount:", tieredDiscountAddress)

    const controller = await ethers.getContractAt("Controller", controllerAddress)
    const overridableFeeManager = await ethers.getContractAt("OverridableFeeManager", overridableFeeManagerAddress)
    const tieredDiscount = await ethers.getContractAt("TieredDiscount", tieredDiscountAddress)

    await pre.assertCode("OverridableFeeManager", overridableFeeManagerAddress, "OverridableFeeManager")
    await pre.assertCode("TieredDiscount", tieredDiscountAddress, "TieredDiscount")
    await pre.assertCode("Factory", factoryAddress)
    await pre.assertOwner("OverridableFeeManager", overridableFeeManager)
    if (setControllerDefault) {
        await pre.assertCode("Controller", controllerAddress, "Controller")
        await pre.assertOwner("Controller", controller)
    }

    const discountToken = await tieredDiscount.token()
    const tiers: string[] = []
    for (let i = 0; ; i++) {
        try {
            tiers.push(`${(await tieredDiscount.thresholds(i)).toString()} -> ${await tieredDiscount.discounts(i)} bps`)
        } catch {
            break
        }
    }
    await tieredDiscount.callStatic.computeFeeFor(2500, pre.signerAddress)
    console.log("Discount token:", discountToken)
    console.log("Discount tiers:", tiers)

    const currentOverridableDefault = ethers.utils.getAddress(await overridableFeeManager.defaultFeeManager())
    if (currentOverridableDefault !== tieredDiscountAddress) {
        await pre.mutate({
            label: "OverridableFeeManager.setDefaultFeeManager",
            contract: overridableFeeManager,
            method: "setDefaultFeeManager",
            args: [tieredDiscountAddress],
            readState: () => overridableFeeManager.defaultFeeManager(),
            expectedAfter: tieredDiscountAddress,
        })
    } else {
        console.log("Overridable default already points at the tiered discount manager")
    }

    if (setControllerDefault) {
        const currentControllerDefault = ethers.utils.getAddress(await controller.defaultFeeManager(factoryAddress))
        if (currentControllerDefault !== overridableFeeManagerAddress) {
            await pre.mutate({
                label: "Controller.setDefaultFeeManager",
                contract: controller,
                method: "setDefaultFeeManager",
                args: [factoryAddress, overridableFeeManagerAddress],
                readState: () => controller.defaultFeeManager(factoryAddress),
                expectedAfter: overridableFeeManagerAddress,
            })
        } else {
            console.log("Controller default already points at the overridable fee manager")
        }
    }

    const finalOverridableDefault = ethers.utils.getAddress(await overridableFeeManager.defaultFeeManager())
    const finalControllerDefault = ethers.utils.getAddress(await controller.defaultFeeManager(factoryAddress))
    console.log("Final Overridable default:", finalOverridableDefault)
    console.log("Final Controller default for factory:", finalControllerDefault)
    if (finalOverridableDefault !== tieredDiscountAddress) {
        throw new Error("Overridable default does not point at the tiered discount manager after configuration")
    }
    if (setControllerDefault && finalControllerDefault !== overridableFeeManagerAddress) {
        throw new Error("Controller default does not point at the overridable fee manager after configuration")
    }
}

async function main() {
    const pre = await Preflight.create()
    await configureDiscountDefaults(
        pre,
        envAddress("VINUSWAP_CONTROLLER_ADDRESS", DEFAULT_CONTROLLER_ADDRESS),
        envAddress("VINUSWAP_FACTORY_ADDRESS", DEFAULT_FACTORY_ADDRESS),
        envAddress("VINUSWAP_OVERRIDABLE_FEE_MANAGER_ADDRESS", DEFAULT_OVERRIDABLE_FEE_MANAGER_ADDRESS),
        envAddress("VINUSWAP_TIERED_DISCOUNT_ADDRESS", DEFAULT_TIERED_DISCOUNT_ADDRESS),
        envFlag("VINUSWAP_SET_CONTROLLER_DEFAULT", true)
    )
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
