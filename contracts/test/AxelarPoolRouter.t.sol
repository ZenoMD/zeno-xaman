// SPDX-License-Identifier: MIT
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

    // The source address the non-allow-list tests exercise shield() through;
    // whitelisted in setUp() so they exercise shield() itself rather than the
    // allow list (which gets its own tests below).
    bytes constant SOURCE_ADDRESS = "";

    AxelarPoolRouter router;

    function setUp() public {
        vm.createSelectFork("https://rpc.xrplevm.org");
        router = new AxelarPoolRouter(ITS, RailgunSmartWallet(POOL));
        router.setAllowedSourceAddress(SOURCE_ADDRESS, true);
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
        router.executeWithInterchainToken(
            bytes32(0), "xrpl", SOURCE_ADDRESS, _payload(), bytes32(0), TOKEN, itsAmountParam
        );
    }

    /// Router holds exactly the ITS `_amount`.
    function test_shield_exactDelivery() public {
        _credit(1e18);
        _exec(1e18);
        assertEq(IERC20(TOKEN).balanceOf(address(router)), 0, "router not drained");
    }

    /// The router trusts ITS's declared `_amount` outright — it never reads its
    /// own balance. So if ITS says 1 XRP but a fee means less actually landed,
    /// the router still tries to pull the full 1 XRP, and pool.shield()'s
    /// transferFrom reverts rather than falling back to what was truly
    /// delivered.
    function test_revert_feeDeducted() public {
        _credit(0.99e18);
        vm.expectRevert(); // token's own "transfer amount exceeds balance"
        _exec(1e18); // param larger than what was actually delivered
    }

    /// Nothing delivered -> the same trust-the-param behavior as above, just
    /// with a 0 balance instead of a partial one; still a plain transferFrom
    /// revert, not a distinct diagnostic message.
    function test_revert_nothingReceived() public {
        vm.expectRevert();
        _exec(1e18);
    }

    /// Only ITS may invoke.
    function test_revert_notService() public {
        _credit(1e18);
        vm.expectRevert();
        router.executeWithInterchainToken(bytes32(0), "xrpl", SOURCE_ADDRESS, _payload(), bytes32(0), TOKEN, 1e18);
    }

    /// A source address that was never allow-listed is rejected before the
    /// shield logic runs at all — even with tokens already delivered.
    function test_revert_sourceNotAllowed() public {
        _credit(1e18);
        bytes memory unknownSource = "not-on-the-list";

        vm.prank(ITS);
        vm.expectRevert("Depositing address is not allowed");
        router.executeWithInterchainToken(bytes32(0), "xrpl", unknownSource, _payload(), bytes32(0), TOKEN, 1e18);
    }

    /// setAllowedSourceAddress can both add and remove a source; a removed
    /// source is rejected again.
    function test_setAllowedSourceAddress_addAndRemove() public {
        bytes memory source = "some-xrpl-source";
        assertFalse(router.allowList(source), "should start disallowed");

        router.setAllowedSourceAddress(source, true);
        assertTrue(router.allowList(source), "should be allowed after adding");

        router.setAllowedSourceAddress(source, false);
        assertFalse(router.allowList(source), "should be disallowed after removing");
    }

    /// Only an ALLOW_LIST_MODIFIER_ROLE holder may edit the allow list.
    function test_revert_setAllowedSourceAddress_unauthorized() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        router.setAllowedSourceAddress("some-xrpl-source", true);
    }

    /// The deployer holds ALLOW_LIST_MODIFIER_ROLE from the constructor and can
    /// grant it to another account, which can then itself edit the allow list.
    function test_grantRole_newModifierCanEditAllowList() public {
        address newModifier = address(0xCAFE);
        router.grantRole(router.ALLOW_LIST_MODIFIER_ROLE(), newModifier);

        vm.prank(newModifier);
        router.setAllowedSourceAddress("granted-by-new-modifier", true);
        assertTrue(router.allowList("granted-by-new-modifier"));
    }

    /// grantRole is itself gated on the role's own admin (DEFAULT_ADMIN_ROLE),
    /// not just any existing ALLOW_LIST_MODIFIER_ROLE holder.
    function test_revert_grantRole_unauthorized() public {
        // Read before pranking: an inline `router.ALLOW_LIST_MODIFIER_ROLE()`
        // argument would itself be "the next call", consuming the prank/revert
        // expectation before grantRole ever runs.
        bytes32 role = router.ALLOW_LIST_MODIFIER_ROLE();
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        router.grantRole(role, address(0xCAFE));
    }
}
