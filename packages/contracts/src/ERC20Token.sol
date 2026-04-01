// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ERC20Token is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, ERC20Capped, Ownable {
    bool public mintingEnabled;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 cap_,
        bool mintingEnabled_,
        address owner_
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        ERC20Capped(cap_ > 0 ? cap_ : type(uint256).max)
        Ownable(owner_)
    {
        mintingEnabled = mintingEnabled_;
        _mint(owner_, initialSupply_);
    }

    function mint(address to, uint256 amount) public onlyOwner {
        require(mintingEnabled, "Minting disabled");
        _mint(to, amount);
    }

    function pause() public onlyOwner { _pause(); }
    function unpause() public onlyOwner { _unpause(); }

    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Pausable, ERC20Capped) {
        super._update(from, to, value);
    }
}
