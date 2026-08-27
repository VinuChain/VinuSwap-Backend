const fs = require("fs")
require("@nomiclabs/hardhat-ethers")
require('solidity-docgen');
import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers"
import "hardhat-tracer"
import "@nomicfoundation/hardhat-toolbox"

import "hardhat-contract-sizer"

function loadLocalEnv(path: string = ".env") {
    if (!fs.existsSync(path)) {
        return
    }

    for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) {
            continue
        }

        const separator = trimmed.indexOf("=")
        if (separator === -1) {
            continue
        }

        const key = trimmed.slice(0, separator).trim()
        let value = trimmed.slice(separator + 1).trim()
        if (!key || process.env[key] !== undefined) {
            continue
        }

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1)
        }

        process.env[key] = value
    }
}

function normalizePrivateKey(value?: string) {
    if (!value) {
        return undefined
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return undefined
    }

    return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
}

loadLocalEnv()

const vinuOwnerPrivateKey = normalizePrivateKey(
    process.env.VINUSWAP_OWNER_PRIVATE_KEY || process.env.PRIVATE_KEY
)

export default{
    defaultNetwork: "hardhat",
    solidity: {
        compilers: [
            {
                version: "0.7.6",
                sourcesDir: '@uniswap/v3-core/contracts',
                settings: {
                    optimizer: {
                    enabled: true,
                    runs: 200,
                    details: { yul: false },
                    },
                }
            },
            {
                version: "0.4.18",
                sourcesDir: '@uniswap/v3-core/contracts',
                settings: {
                    optimizer: {
                    enabled: true,
                    runs: 200,
                    details: { yul: false },
                    },
                }
            }
        ],
        overrides: {
            "contracts/periphery/NonfungiblePositionManager.sol": {
                version: "0.7.6",
                settings: {
                    optimizer: {
                    enabled: true,
                    runs: 1,
                    details: { yul: false },
                    },
                }
            },
            "contracts/core/VinuSwapFactory.sol": {
                version: "0.7.6",
                settings: {
                    optimizer: {
                    enabled: true,
                    runs: 1,
                    details: { yul: false },
                    },
                }
            },
            "contracts/extra/PoolInitHelper.sol": {
                version: "0.7.6",
                settings: {
                    optimizer: {
                    enabled: true,
                    runs: 1,
                    details: { yul: false },
                    },
                }
            },
            // Same settings as the factory so the probe hashes the exact pool creation code.
            "contracts/test/PoolInitCodeHashProbe.sol": {
                version: "0.7.6",
                settings: {
                    optimizer: {
                    enabled: true,
                    runs: 1,
                    details: { yul: false },
                    },
                }
            }
        }
        
    },
    contractSizer: {
        // Run with `npx hardhat size-contracts` on demand instead of every compile.
        runOnCompile: false
    },
    networks: {
        hardhat: {
            // allowUnlimitedContractSize is a per-network option; at config root
            // Hardhat ignores it. The in-network size limit is what matters for
            // local test deployments, so it lives here.
            allowUnlimitedContractSize: true,
            // Generating + funding 2000 signers slows hardhat node startup
            // significantly; 80 covers the SDK suite's unique signer helper. Set
            // HARDHAT_ACCOUNTS_COUNT to override for stress tests.
            accounts: {
                count: parseInt(process.env.HARDHAT_ACCOUNTS_COUNT ?? "80", 10)
            }
        },
        vinu: {
            // Pin the chain ID so a wrong or hijacked RPC URL cannot trick ethers
            // into signing transactions for a different chain (audit L-3).
            chainId: 207,
            url: process.env.VINUSWAP_RPC_URL || "https://rpc.vinuchain.org",
            accounts: vinuOwnerPrivateKey ? [vinuOwnerPrivateKey] : []
        }
    }
}
