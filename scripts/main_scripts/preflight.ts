// Shared guard rails for every admin/deploy entry point under scripts/main_scripts.
//
// Checklist implemented here (docs/OWNERSHIP.md runbook):
//   - provider chainId must equal the network's pinned chainId (207 for --network vinu)
//   - signer + balance are printed; signer must be owner() of every mutated target
//   - every target must have code; when an artifact is named, the live runtime code must
//     equal the artifact's deployedBytecode modulo CBOR metadata
//   - every mutation is callStatic-simulated, printed before/after, and gated on
//     VINUSWAP_CONFIRM=<target address | yes>; post-state is re-read and asserted
//   - a JSON record (chainId, signer, tx hash, block, before/after) is written to
//     deployments/<network>-<timestamp>.json (dir override: VINUSWAP_DEPLOYMENTS_DIR)
//   - periphery deployments refuse a factory whose live pool init code hash differs from
//     the hash the compiled periphery artifacts embed
import fs from 'fs'
import path from 'path'
import hre, { ethers } from 'hardhat'
import { BigNumber, Contract, ContractFactory, ContractReceipt, Signer } from 'ethers'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Factories whose pool init code hash is known out of band (checksummed address -> hash).
// VinuChain mainnet (207): CREATE2 with this hash reproduces every live pool
// (see test/vinuswap-deltas.spec.ts 'pure CREATE2').
export const KNOWN_FACTORY_INIT_CODE_HASHES: Record<string, string> = {
    '0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe':
        '0xe8b892178c932bab07f2a26456a3a5e2c79d3301113659dc834ca80e3ea3596e',
}

// Periphery artifacts that embed PoolAddress.POOL_INIT_CODE_HASH.
const PERIPHERY_ARTIFACTS = ['SwapRouter', 'NonfungiblePositionManager', 'VinuSwapQuoter']

export interface MutationRecord {
    label: string
    to: string
    method: string
    args: string[]
    txHash: string
    blockNumber: number
    before: unknown
    after: unknown
}

export interface DeployRecord {
    address: string
    txHash: string
    blockNumber: number
    args: string[]
}

export interface DeploymentRecord {
    network: string
    chainId: number
    signer: string
    startedAt: string
    deployed: Record<string, DeployRecord>
    mutations: MutationRecord[]
}

export class Preflight {
    readonly network: string
    readonly chainId: number
    readonly signer: Signer
    readonly signerAddress: string
    readonly record: DeploymentRecord
    readonly recordPath: string

    private constructor(network: string, chainId: number, signer: Signer, signerAddress: string) {
        this.network = network
        this.chainId = chainId
        this.signer = signer
        this.signerAddress = signerAddress
        const startedAt = new Date().toISOString()
        this.record = { network, chainId, signer: signerAddress, startedAt, deployed: {}, mutations: [] }
        const dir = process.env.VINUSWAP_DEPLOYMENTS_DIR || path.join(REPO_ROOT, 'deployments')
        this.recordPath = path.join(dir, `${network}-${startedAt.replace(/[:.]/g, '-')}.json`)
    }

    static async create(): Promise<Preflight> {
        const expectedChainId = hre.network.config.chainId
        if (!expectedChainId) {
            throw new Error(`Network '${hre.network.name}' has no pinned chainId in hardhat.config.ts; refusing to run`)
        }
        const { chainId } = await ethers.provider.getNetwork()
        if (chainId !== expectedChainId) {
            throw new Error(`Provider chainId ${chainId} != expected ${expectedChainId} for network '${hre.network.name}'`)
        }

        const [signer] = await ethers.getSigners()
        if (!signer) {
            throw new Error('No signer configured. Add VINUSWAP_OWNER_PRIVATE_KEY to .env.')
        }
        const signerAddress = ethers.utils.getAddress(await signer.getAddress())
        const balance = await signer.getBalance()
        console.log(`Network: ${hre.network.name} (chainId ${chainId})`)
        console.log(`Signer: ${signerAddress} balance: ${ethers.utils.formatEther(balance)}`)
        if (balance.isZero()) {
            throw new Error('Signer has zero balance')
        }

        return new Preflight(hre.network.name, chainId, signer, signerAddress)
    }

    async assertOwner(label: string, contract: Contract): Promise<void> {
        const owner = ethers.utils.getAddress(await contract.owner())
        if (owner !== this.signerAddress) {
            throw new Error(`${label} owner is ${owner}, but signer is ${this.signerAddress}`)
        }
    }

    /// Asserts `address` has code. With `artifactName`, the live runtime code must equal the
    /// artifact's deployedBytecode modulo CBOR metadata, unless the address is listed in
    /// VINUSWAP_ALLOW_BYTECODE_MISMATCH (comma-separated) - use that only after establishing
    /// which source revision the live contract was built from.
    async assertCode(label: string, address: string, artifactName?: string): Promise<void> {
        const code = await ethers.provider.getCode(address)
        if (code === '0x') {
            throw new Error(`${label} at ${address} has no code on chainId ${this.chainId}`)
        }
        if (!artifactName) {
            return
        }
        const artifact = await hre.artifacts.readArtifact(artifactName)
        if (stripMetadata(code) === stripMetadata(artifact.deployedBytecode)) {
            return
        }
        const allowed = (process.env.VINUSWAP_ALLOW_BYTECODE_MISMATCH || '')
            .split(',')
            .filter(Boolean)
            .map((a) => ethers.utils.getAddress(a.trim()))
        if (allowed.includes(ethers.utils.getAddress(address))) {
            console.warn(`WARNING: ${label} at ${address} does not match artifact ${artifactName}; proceeding (VINUSWAP_ALLOW_BYTECODE_MISMATCH)`)
            return
        }
        throw new Error(
            `${label} at ${address}: live bytecode does not match artifact ${artifactName} (metadata stripped). ` +
            `HEAD may not reproduce the deployed source. Set VINUSWAP_ALLOW_BYTECODE_MISMATCH=${address} to proceed anyway.`
        )
    }

    /// Simulates, confirms, sends and records a state-changing call. `readState` is read
    /// before and after; when `expectedAfter` is given the post-state must equal it.
    async mutate<T>(opts: {
        label: string
        contract: Contract
        method: string
        args: unknown[]
        readState: () => Promise<T>
        expectedAfter?: T
    }): Promise<ContractReceipt> {
        const { label, contract, method, args, readState, expectedAfter } = opts
        const before = await readState()
        console.log(`\n[${label}] ${contract.address}.${method}(${args.map(String).join(', ')})`)
        console.log(`[${label}] before:`, serialize(before))
        await contract.connect(this.signer).callStatic[method](...args)
        console.log(`[${label}] simulation OK`)
        if (expectedAfter !== undefined) {
            console.log(`[${label}] expected after:`, serialize(expectedAfter))
        }
        requireConfirmation(label, contract.address)

        const tx = await contract.connect(this.signer)[method](...args)
        console.log(`[${label}] tx: ${tx.hash}`)
        const receipt = await tx.wait()
        const after = await readState()
        console.log(`[${label}] confirmed in block ${receipt.blockNumber}; after:`, serialize(after))
        if (expectedAfter !== undefined && serialize(after) !== serialize(expectedAfter)) {
            throw new Error(`[${label}] post-state ${serialize(after)} != expected ${serialize(expectedAfter)}`)
        }

        this.record.mutations.push({
            label,
            to: contract.address,
            method,
            args: args.map(String),
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            before: JSON.parse(serialize(before)),
            after: JSON.parse(serialize(after)),
        })
        this.save()
        return receipt
    }

    /// Simulates the constructor, confirms (VINUSWAP_CONFIRM=yes), deploys and records.
    async deploy(label: string, factory: ContractFactory, args: unknown[] = []): Promise<Contract> {
        console.log(`\n[deploy ${label}] args: ${args.map(String).join(', ') || '(none)'}`)
        const connected = factory.connect(this.signer)
        await this.signer.call(connected.getDeployTransaction(...args))
        console.log(`[deploy ${label}] constructor simulation OK`)
        requireConfirmation(`deploy ${label}`)

        const contract = await connected.deploy(...args)
        const receipt = await contract.deployTransaction.wait()
        console.log(`[deploy ${label}] ${contract.address} (tx ${receipt.transactionHash}, block ${receipt.blockNumber})`)
        this.record.deployed[label] = {
            address: contract.address,
            txHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            args: args.map(String),
        }
        this.save()
        return contract
    }

    save(): void {
        fs.mkdirSync(path.dirname(this.recordPath), { recursive: true })
        fs.writeFileSync(this.recordPath, JSON.stringify(this.record, null, 2) + '\n')
    }
}

function requireConfirmation(label: string, target?: string): void {
    const confirm = (process.env.VINUSWAP_CONFIRM || '').trim()
    if (confirm.toLowerCase() === 'yes') {
        return
    }
    if (target && ethers.utils.isAddress(confirm) && ethers.utils.getAddress(confirm) === ethers.utils.getAddress(target)) {
        return
    }
    throw new Error(
        `[${label}] not confirmed. Re-run with VINUSWAP_CONFIRM=${target ?? 'yes'}` +
        (target ? ` (or VINUSWAP_CONFIRM=yes)` : '')
    )
}

function serialize(value: unknown): string {
    // BigNumber.toJSON() yields {type:'BigNumber', hex} before the replacer sees it.
    return JSON.stringify(value, (_k, v) =>
        v && typeof v === 'object' && v.type === 'BigNumber' && typeof v.hex === 'string' ? BigNumber.from(v.hex).toString() : v
    )
}

/// Drops the trailing CBOR metadata (its last two bytes encode its length).
export function stripMetadata(bytecode: string): string {
    const hex = bytecode.toLowerCase().replace(/^0x/, '')
    const cborLength = parseInt(hex.slice(-4), 16)
    const bodyLength = hex.length - (cborLength + 2) * 2
    return bodyLength > 0 ? hex.slice(0, bodyLength) : hex
}

export function readSourcePoolInitCodeHash(): string {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'contracts/periphery/libraries/PoolAddress.sol'), 'utf8')
    const match = source.match(/POOL_INIT_CODE_HASH\s*=\s*(0x[0-9a-fA-F]{64})/)
    if (!match) {
        throw new Error('Could not find POOL_INIT_CODE_HASH in PoolAddress.sol')
    }
    return match[1].toLowerCase()
}

/// Refuses to deploy periphery whose embedded pool init code hash cannot reproduce the
/// factory's pools. Evidence, in order: CREATE2 of an existing pool from PoolCreated logs,
/// the KNOWN_FACTORY_INIT_CODE_HASHES pin, or — for a pool-less factory — proven provenance:
/// either the caller deployed the factory from these artifacts in the same run
/// (`deployedFromArtifacts`) or VINUSWAP_INIT_CODE_HASH declares a verified hash. A pool-less
/// factory of unknown origin is refused: nothing on-chain shows which pool creation code it embeds.
export async function assertPeripheryInitCodeHash(
    factoryAddress: string,
    options: { deployedFromArtifacts?: boolean } = {}
): Promise<string> {
    const artifactHash = readSourcePoolInitCodeHash()
    for (const name of PERIPHERY_ARTIFACTS) {
        const artifact = await hre.artifacts.readArtifact(name)
        if (!artifact.deployedBytecode.toLowerCase().includes(artifactHash.slice(2))) {
            throw new Error(`Artifact ${name} does not embed PoolAddress hash ${artifactHash}; run 'npx hardhat compile'`)
        }
    }

    const checksummed = ethers.utils.getAddress(factoryAddress)
    const pinned = KNOWN_FACTORY_INIT_CODE_HASHES[checksummed]
    const factory = await ethers.getContractAt('VinuSwapFactory', checksummed)
    const logs = await factory.queryFilter(factory.filters.PoolCreated(), 0, 'latest')
    if (logs.length > 0) {
        const { token0, token1, fee, pool } = logs[0].args
        const salt = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint24'], [token0, token1, fee])
        )
        const derived = ethers.utils.getCreate2Address(checksummed, salt, artifactHash)
        if (derived.toLowerCase() !== pool.toLowerCase()) {
            throw new Error(
                `Periphery artifacts embed pool init code hash ${artifactHash}, which does not reproduce ` +
                `pool ${pool} (${token0}/${token1}/${fee}) on factory ${checksummed}` +
                (pinned ? `; the live hash for this factory is ${pinned}` : '') +
                `. Refusing to deploy periphery that would compute non-existent pool addresses.`
            )
        }
        console.log(`Init code hash ${artifactHash} reproduces pool ${pool} on factory ${checksummed}`)
        return artifactHash
    }

    if (pinned) {
        if (pinned.toLowerCase() !== artifactHash) {
            throw new Error(`Periphery artifacts embed ${artifactHash} but factory ${checksummed} is pinned to ${pinned}`)
        }
        return artifactHash
    }

    const declared = (process.env.VINUSWAP_INIT_CODE_HASH || '').trim().toLowerCase()
    if (!options.deployedFromArtifacts && !declared) {
        throw new Error(
            `Factory ${checksummed} has no pools and is not pinned, so nothing proves which pool init code hash it embeds. ` +
            `Create a pool on it first, or set VINUSWAP_INIT_CODE_HASH=<hash verified from the factory's source/PoolInitHelper>; ` +
            `it must equal the hash these artifacts embed (${artifactHash}).`
        )
    }
    if (declared && declared !== artifactHash) {
        throw new Error(`Periphery artifacts embed ${artifactHash} but VINUSWAP_INIT_CODE_HASH declares ${declared}`)
    }
    // Provenance established; still cross-check against the locally compiled pool creation code
    // so stale artifacts cannot slip through.
    const probe = await hre.artifacts.readArtifact('PoolInitCodeHashProbe')
    const probeHash = (await ethers.provider.call({ data: probe.bytecode })).toLowerCase()
    if (probeHash !== artifactHash) {
        throw new Error(`Periphery artifacts embed ${artifactHash} but the compiled pool creation code hashes to ${probeHash}`)
    }
    console.log(
        `Factory ${checksummed} has no pools; init code hash ${artifactHash} matches ` +
        (options.deployedFromArtifacts ? 'the factory just deployed from these artifacts' : 'VINUSWAP_INIT_CODE_HASH') +
        ' and the compiled pool creation code'
    )
    return artifactHash
}

export function loadJsonFile(filePath: string): any {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function saveJsonFile(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}
