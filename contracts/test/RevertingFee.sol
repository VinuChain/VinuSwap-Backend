// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import '../core/interfaces/IFeeManager.sol';

/// @dev Test fee manager whose computeFee always reverts (models a broken/malicious fee policy).
contract RevertingFee is IFeeManager {
    function computeFee(uint24) external pure override returns (uint24) {
        revert('RevertingFee');
    }
}
