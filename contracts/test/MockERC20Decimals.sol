// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.7.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/// @dev MockERC20 with configurable symbol/decimals (e.g. a 6-decimal USDT stand-in).
contract MockERC20Decimals is ERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _setupDecimals(decimals_);
    }

    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
