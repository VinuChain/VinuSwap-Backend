// Deploys VinuSwapQuoter against the configured factory, refusing when the compiled periphery
// embeds a pool init code hash that cannot reproduce that factory's pools.
import { ethers } from 'hardhat'
import { Preflight, assertPeripheryInitCodeHash, loadJsonFile, saveJsonFile } from './preflight'

export async function deployQuoter(pre: Preflight, factoryAddress: string, WETH: string) {
    await pre.assertCode('Factory', factoryAddress)
    await pre.assertCode('WETH9', WETH)
    await assertPeripheryInitCodeHash(factoryAddress)

    const quoterContract = await pre.deploy('VinuSwapQuoter', await ethers.getContractFactory('VinuSwapQuoter'), [factoryAddress, WETH])

    if (ethers.utils.getAddress(await quoterContract.factory()) !== ethers.utils.getAddress(factoryAddress)) {
        throw new Error('Deployed quoter does not point at the requested factory')
    }
    return quoterContract
}

async function main() {
    const config = loadJsonFile('deployment_config.json')
    const pre = await Preflight.create()

    const quoter = await deployQuoter(pre, config.commonContracts.factory, config.tokens.wvc.address)

    config.commonContracts.quoter = quoter.address
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
