// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title DustLens
 * @notice Makes Arc's dual-decimal USDC visible from on-chain.
 *
 * On Arc, USDC is the native gas token and one balance is exposed twice:
 *
 *   native   `address.balance`   18 decimals   the real value
 *   ERC-20   `balanceOf()`        6 decimals   a truncating projection
 *
 * The ERC-20 view is served by a precompile that forwards to the account's
 * native balance, so they are not two tokens. The projection floors, which
 * means every account can hold value below 1e-6 USDC that no ERC-20 transfer
 * can ever move.
 *
 * This contract reports both readings and the remainder between them, so the
 * relationship can be checked on-chain rather than taken on faith. It holds no
 * funds and has no owner.
 */
contract DustLens {
    /// @notice ERC-20 interface onto the native USDC balance.
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// @notice Ratio between the two interfaces: 10 ** (18 - 6).
    uint256 public constant SCALE = 1e12;

    /// @notice Native balance, at full 18-decimal precision.
    function nativeBalanceOf(address account) public view returns (uint256) {
        return account.balance;
    }

    /// @notice What the 6-decimal ERC-20 interface reports for the same account.
    function erc20BalanceOf(address account) public view returns (uint256) {
        return IERC20(USDC).balanceOf(account);
    }

    /**
     * @notice Value held below the ERC-20 interface's resolution.
     * @dev Real balance that no ERC-20 transfer can move.
     */
    function dustOf(address account) public view returns (uint256) {
        return account.balance % SCALE;
    }

    /// @notice Largest amount that survives a round trip through the ERC-20 view.
    function transferableOf(address account) public view returns (uint256) {
        return (account.balance / SCALE) * SCALE;
    }

    /**
     * @notice Read both interfaces in one call, so they cannot straddle a block.
     * @dev Arc produces a block roughly every 500ms. Two separate eth_calls at
     *      `latest` can land either side of one and look like the invariant broke.
     * @return nativeBalance 18-decimal balance
     * @return erc20Balance 6-decimal balance as reported by the precompile
     * @return dust remainder the ERC-20 view cannot express
     * @return consistent whether erc20Balance == nativeBalance / SCALE
     */
    function inspect(address account)
        external
        view
        returns (uint256 nativeBalance, uint256 erc20Balance, uint256 dust, bool consistent)
    {
        nativeBalance = account.balance;
        erc20Balance = IERC20(USDC).balanceOf(account);
        dust = nativeBalance % SCALE;
        consistent = erc20Balance == nativeBalance / SCALE;
    }

    /// @notice Batch form of {inspect}, for indexers and dashboards.
    function inspectMany(address[] calldata accounts)
        external
        view
        returns (uint256[] memory nativeBalances, uint256[] memory erc20Balances, uint256[] memory dusts)
    {
        uint256 length = accounts.length;
        nativeBalances = new uint256[](length);
        erc20Balances = new uint256[](length);
        dusts = new uint256[](length);

        for (uint256 i = 0; i < length; ++i) {
            address account = accounts[i];
            uint256 balance = account.balance;
            nativeBalances[i] = balance;
            erc20Balances[i] = IERC20(USDC).balanceOf(account);
            dusts[i] = balance % SCALE;
        }
    }

    /// @notice The decimals the precompile reports, read live rather than assumed.
    function erc20Decimals() external view returns (uint8) {
        return IERC20(USDC).decimals();
    }

    /**
     * @notice Split `msg.value` evenly, leaving nothing stranded in this contract.
     * @dev A naive split sends `msg.value / n` to each recipient and silently
     *      keeps the remainder forever. Here the remainder goes to the first
     *      recipient, so the contract's balance is unchanged by the call.
     *
     *      Amounts are native, so the split is exact to 1e-18 even though the
     *      ERC-20 view could not represent most of these values.
     */
    function splitEvenly(address[] calldata recipients) external payable {
        uint256 count = recipients.length;
        require(count > 0, "DustLens: no recipients");
        require(msg.value >= count, "DustLens: amount below one wei each");

        uint256 share = msg.value / count;
        uint256 remainder = msg.value % count;

        for (uint256 i = 0; i < count; ++i) {
            uint256 amount = i == 0 ? share + remainder : share;
            (bool ok,) = recipients[i].call{value: amount}("");
            require(ok, "DustLens: transfer failed");
        }

        emit Split(msg.sender, msg.value, count, remainder);
    }

    event Split(address indexed from, uint256 total, uint256 recipients, uint256 remainder);
}
