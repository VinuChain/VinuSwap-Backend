// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;

import '../core/VinuSwapPool.sol';

/// @dev Never deployed. Its creation code, executed via eth_call (no `to`), returns the pool
/// init code hash as the 32-byte "runtime code", so deploy scripts can read the hash of the
/// pool creation code these artifacts embed without spending gas. Must be compiled with the
/// factory's optimizer settings (runs:1, see hardhat.config.ts overrides).
contract PoolInitCodeHashProbe {
    constructor() {
        bytes32 hash = keccak256(abi.encodePacked(type(VinuSwapPool).creationCode));
        assembly {
            mstore(0, hash)
            return(0, 32)
        }
    }
}
