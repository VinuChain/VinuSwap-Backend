#!/usr/bin/env node
// Guard the known production-audit residual while the Solidity 0.8 /
// OpenZeppelin major migration remains a separate contract-facing project.

const { spawnSync } = require('child_process')

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const EXPECTED_OPENZEPPELIN_SOURCES = new Set([
    1089132,
    1090433,
    1092641,
    1094945,
])

const MAX_BASELINE_COUNTS = {
    low: 16,
    moderate: 11,
    total: 28,
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

    try {
        return JSON.parse(result.stdout)
    } catch (error) {
        throw new Error(`Failed to parse npm audit JSON: ${error.message}`)
    }
}

function advisorySources(vulnerability) {
    return (vulnerability.via || [])
        .filter((entry) => typeof entry === 'object' && entry.source != null)
        .map((entry) => Number(entry.source))
}

function main() {
    const report = runAudit()
    const vulnerabilities = report.vulnerabilities || {}
    const counts = report.metadata?.vulnerabilities || {}
    const errors = []

    if ((counts.critical || 0) !== 0) {
        errors.push(`expected 0 critical production vulnerabilities, found ${counts.critical}`)
    }

    const highOrCritical = Object.values(vulnerabilities).filter((vulnerability) =>
        vulnerability.severity === 'high' || vulnerability.severity === 'critical'
    )
    const unexpected = highOrCritical.filter(
        (vulnerability) => vulnerability.name !== '@openzeppelin/contracts'
    )

    for (const vulnerability of unexpected) {
        errors.push(
            `unexpected ${vulnerability.severity} production vulnerability: ` +
                `${vulnerability.name}`
        )
    }

    const openzeppelin = vulnerabilities['@openzeppelin/contracts']
    if (!openzeppelin) {
        errors.push('expected known @openzeppelin/contracts residual, but it was absent')
    } else {
        if (openzeppelin.severity !== 'high') {
            errors.push(
                `expected @openzeppelin/contracts residual severity high, found ` +
                    `${openzeppelin.severity}`
            )
        }
        if (!openzeppelin.isDirect) {
            errors.push('expected @openzeppelin/contracts to remain a direct dependency')
        }

        const sources = new Set(advisorySources(openzeppelin))
        for (const source of EXPECTED_OPENZEPPELIN_SOURCES) {
            if (!sources.has(source)) {
                errors.push(`missing expected OpenZeppelin advisory source ${source}`)
            }
        }
        for (const source of sources) {
            if (!EXPECTED_OPENZEPPELIN_SOURCES.has(source)) {
                errors.push(`unexpected OpenZeppelin advisory source ${source}`)
            }
        }
    }

    if ((counts.high || 0) !== 1) {
        errors.push(`expected exactly 1 high production vulnerability, found ${counts.high}`)
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
