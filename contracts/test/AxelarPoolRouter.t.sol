// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AxelarPoolRouter} from "../src/AxelarPoolRouter.sol";
import {RailgunSmartWallet} from "@railgun/logic/RailgunSmartWallet.sol";
import {ShieldCiphertext} from "@railgun/logic/Globals.sol";

/// Fork test: exercises the router against the REAL mainnet RAILGUN pool, XRP
/// token, and ITS — no deploy, no gas. Run: `forge test --match-path test/AxelarPoolRouter.t.sol -vvv`
///
/// Scope: validates router -> pool.shield() given that ITS has credited the
/// router (simulated by setting its token balance). It does NOT exercise ITS's
/// own delivery (`_giveToken`); that's the one piece a fork can't cheaply mock.
contract AxelarPoolRouterForkTest is Test {
    // axelar-chains-config mainnet.json (xrpl-evm) + railgun-deployment.js
    address constant ITS = 0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C;
    address constant POOL = 0x3e38d868dF209e8c0de1F0b4a2654BE07336182A;
    address constant TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE; // XRP (18 dp)
    uint256 constant BALANCES_SLOT = 2; // verified via eth_getStorageAt probe

    AxelarPoolRouter router;

    function setUp() public {
        vm.createSelectFork("https://rpc.xrplevm.org");
        router = new AxelarPoolRouter(ITS, RailgunSmartWallet(POOL));
    }

    // Mimic ITS crediting the executable by writing the router's token balance.
    function _credit(uint256 amount) internal {
        vm.store(TOKEN, keccak256(abi.encode(address(router), BALANCES_SLOT)), bytes32(amount));
        assertEq(IERC20(TOKEN).balanceOf(address(router)), amount, "balance setup failed");
    }

    // Dummy recipient payload — shield() only needs npk in-field and value != 0.
    function _payload() internal pure returns (bytes memory) {
        return abi.encode(
            AxelarPoolRouter.ShieldNoteData({
                npk: bytes32(uint256(123456789)),
                ciphertext: ShieldCiphertext({
                    encryptedBundle: [bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3))],
                    shieldKey: bytes32(uint256(4))
                })
            })
        );
    }

    function _exec(uint256 itsAmountParam) internal {
        vm.prank(ITS);
        router.executeWithInterchainToken(bytes32(0), "xrpl", "", _payload(), bytes32(0), TOKEN, itsAmountParam);
    }

    /// Router holds exactly the ITS `_amount`.
    function test_shield_exactDelivery() public {
        _credit(1e18);
        _exec(1e18);
        assertEq(IERC20(TOKEN).balanceOf(address(router)), 0, "router not drained");
    }

    /// ITS says 1 XRP but delivers less (its fee): balanceOf logic shields the
    /// real amount instead of reverting "exceeds balance".
    function test_shield_feeDeducted() public {
        _credit(0.99e18);
        _exec(1e18); // param larger than delivered — must NOT be trusted
        assertEq(IERC20(TOKEN).balanceOf(address(router)), 0, "router not drained");
    }

    /// Nothing delivered -> distinct, diagnostic revert.
    function test_revert_nothingReceived() public {
        vm.prank(ITS);
        vm.expectRevert("AxelarPoolRouter: nothing received");
        router.executeWithInterchainToken(bytes32(0), "xrpl", "", _payload(), bytes32(0), TOKEN, 1e18);
    }

    /// Only ITS may invoke.
    function test_revert_notService() public {
        _credit(1e18);
        vm.expectRevert();
        router.executeWithInterchainToken(bytes32(0), "xrpl", "", _payload(), bytes32(0), TOKEN, 1e18);
    }
}
