// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;

/// @dev Emits the factory's PoolCreated event for an arbitrary pool address so the deploy
/// scripts' init-code-hash guard can be exercised against a mismatching "factory".
contract FakeFactory {
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        int24 tickSpacing,
        address feeManager,
        address pool
    );

    function emitPoolCreated(address token0, address token1, uint24 fee, address pool) external {
        emit PoolCreated(token0, token1, fee, 60, address(0), pool);
    }
}
