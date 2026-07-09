#!/usr/bin/env node
// Guard the known production-audit residual while the Solidity 0.8 /
// OpenZeppelin major migration remains a separate contract-facing project.

const { spawnSync } = require('child_process')

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const MAX_BASELINE_COUNTS = {
    info: 0,
    low: 16,
    moderate: 8,
    high: 1,
    critical: 0,
    total: 25,
}

const SEVERITY_RANK = {
    info: 0,
    low: 1,
    moderate: 2,
    high: 3,
    critical: 4,
}

const KNOWN_PRODUCTION_RESIDUALS = {
    '@ethersproject/abi': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/abi'],
    },
    '@ethersproject/abstract-provider': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/abstract-provider'],
    },
    '@ethersproject/abstract-signer': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/abstract-signer'],
    },
    '@ethersproject/contracts': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/contracts'],
    },
    '@ethersproject/hash': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/hash'],
    },
    '@ethersproject/hdnode': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/hdnode'],
    },
    '@ethersproject/json-wallets': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/json-wallets'],
    },
    '@ethersproject/providers': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/providers'],
    },
    '@ethersproject/signing-key': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/signing-key'],
    },
    '@ethersproject/transactions': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/transactions'],
    },
    '@ethersproject/wallet': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/wallet'],
    },
    '@ethersproject/wordlists': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@ethersproject/wordlists'],
    },
    '@openzeppelin/contracts': {
        severity: 'high',
        isDirect: true,
        sources: [1089132, 1090433, 1092641, 1094945],
        nodes: [
            'node_modules/@openzeppelin/contracts',
            'node_modules/@uniswap/swap-router-contracts/node_modules/@openzeppelin/contracts',
            'node_modules/@uniswap/v3-periphery/node_modules/@openzeppelin/contracts',
            'node_modules/@uniswap/v3-staker/node_modules/@openzeppelin/contracts',
        ],
    },
    '@sentry/node': {
        severity: 'low',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@sentry/node'],
    },
    '@uniswap/swap-router-contracts': {
        severity: 'moderate',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@uniswap/swap-router-contracts'],
    },
    '@uniswap/v3-periphery': {
        severity: 'moderate',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@uniswap/v3-periphery'],
    },
    '@uniswap/v3-sdk': {
        severity: 'moderate',
        isDirect: true,
        sources: [],
        nodes: ['node_modules/@uniswap/v3-sdk'],
    },
    '@uniswap/v3-staker': {
        severity: 'moderate',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/@uniswap/v3-staker'],
    },
    cookie: {
        severity: 'low',
        isDirect: false,
        sources: [1103907],
        nodes: ['node_modules/cookie'],
    },
    elliptic: {
        severity: 'low',
        isDirect: false,
        sources: [1112030],
        nodes: ['node_modules/elliptic'],
    },
    ethers: {
        severity: 'low',
        isDirect: true,
        sources: [],
        nodes: ['node_modules/ethers'],
    },
    hardhat: {
        severity: 'moderate',
        isDirect: true,
        sources: [],
        nodes: ['node_modules/hardhat'],
    },
    'hardhat-watcher': {
        severity: 'moderate',
        isDirect: false,
        sources: [],
        nodes: ['node_modules/hardhat-watcher'],
    },
    'js-yaml': {
        severity: 'moderate',
        isDirect: false,
        sources: [1112715, 1121860],
        nodes: ['node_modules/js-yaml'],
    },
    uuid: {
        severity: 'moderate',
        isDirect: false,
        sources: [1119441],
        nodes: ['node_modules/uuid'],
    },
}

function runAudit() {
    const result = spawnSync(npmBin, ['audit', '--omit=dev', '--json'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
    })

    if (result.error) {
        throw new Error(`Failed to run npm audit: ${result.error.message}`)
    }

    if (result.status !== 0 && result.status !== 1) {
        throw new Error(
            `npm audit exited with ${result.status}:\n${result.stderr || result.stdout}`
        )
    }

    let report
    try {
        report = JSON.parse(result.stdout)
    } catch (error) {
        throw new Error(`Failed to parse npm audit JSON: ${error.message}`)
    }

    validateAuditReport(report)
    return report
}

function validateAuditReport(report) {
    if (report == null || typeof report !== 'object' || Array.isArray(report)) {
        throw new Error('npm audit returned a non-object JSON payload')
    }
    if (report.error) {
        throw new Error(`npm audit returned an error payload: ${JSON.stringify(report.error)}`)
    }
    if (
        report.vulnerabilities == null ||
        typeof report.vulnerabilities !== 'object' ||
        Array.isArray(report.vulnerabilities)
    ) {
        throw new Error('npm audit JSON is missing the vulnerabilities object')
    }
    if (
        report.metadata?.vulnerabilities == null ||
        typeof report.metadata.vulnerabilities !== 'object'
    ) {
        throw new Error('npm audit JSON is missing metadata.vulnerabilities')
    }
}

function advisorySources(vulnerability) {
    return (vulnerability.via || [])
        .filter((entry) => typeof entry === 'object' && entry.source != null)
        .map((entry) => Number(entry.source))
}

function unexpectedValues(actual, expected) {
    const expectedSet = new Set(expected)
    return [...new Set(actual)].filter((value) => !expectedSet.has(value)).sort()
}

function severityRank(severity) {
    return SEVERITY_RANK[severity] ?? Number.POSITIVE_INFINITY
}

function checkKnownResidual(vulnerability, expected, errors) {
    const actualRank = severityRank(vulnerability.severity)
    const expectedRank = severityRank(expected.severity)

    // Sources and nodes are allowed maxima, not required exact sets: this gate
    // should fail when the residual expands or changes identity, but pass when
    // npm audit improves, remediates, or withdraws part of the known baseline.
    if (actualRank > expectedRank) {
        errors.push(
            `${vulnerability.name} severity worsened from ${expected.severity} ` +
                `to ${vulnerability.severity}`
        )
    }

    if (!expected.isDirect && vulnerability.isDirect) {
        errors.push(
            `${vulnerability.name} became a direct production dependency`
        )
    }

    for (const node of unexpectedValues(vulnerability.nodes || [], expected.nodes)) {
        errors.push(`unexpected vulnerable node for ${vulnerability.name}: ${node}`)
    }

    for (const source of unexpectedValues(advisorySources(vulnerability), expected.sources)) {
        errors.push(`unexpected advisory source for ${vulnerability.name}: ${source}`)
    }
}

function main() {
    const report = runAudit()
    const vulnerabilities = report.vulnerabilities || {}
    const counts = report.metadata?.vulnerabilities || {}
    const errors = []

    for (const vulnerability of Object.values(vulnerabilities)) {
        const expected = KNOWN_PRODUCTION_RESIDUALS[vulnerability.name]
        if (!expected) {
            errors.push(
                `unexpected ${vulnerability.severity} production vulnerability: ` +
                    `${vulnerability.name}`
            )
            continue
        }
        checkKnownResidual(vulnerability, expected, errors)
    }

    for (const [severity, maximum] of Object.entries(MAX_BASELINE_COUNTS)) {
        const actual = counts[severity] || 0
        if (actual > maximum) {
            errors.push(
                `expected at most ${maximum} ${severity} production ` +
                    `vulnerabilities, found ${actual}`
            )
        }
    }

    if (errors.length > 0) {
        console.error('Production audit residual guard FAILED:\n')
        for (const error of errors) {
            console.error(`  - ${error}`)
        }
        process.exit(1)
    }

    console.log(
        `Production audit residual guard OK: ${counts.critical || 0} critical, ` +
            `${counts.high || 0} high, ${counts.total || 0} total. ` +
            'No production audit severity count exceeds the known residual baseline.'
    )
}

main()
