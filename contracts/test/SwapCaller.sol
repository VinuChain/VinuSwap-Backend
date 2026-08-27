// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '../periphery/interfaces/ISwapRouter.sol';

/// @dev Test contract that swaps through the router so msg.sender (this) differs from tx.origin.
contract SwapCaller {
    function swap(ISwapRouter router, ISwapRouter.ExactInputSingleParams calldata params) external returns (uint256) {
        IERC20(params.tokenIn).approve(address(router), params.amountIn);
        return router.exactInputSingle(params);
    }
}
