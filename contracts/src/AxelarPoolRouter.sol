// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {
    InterchainTokenExecutable
} from "@axelar-network/interchain-token-service/executable/InterchainTokenExecutable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {RailgunSmartWallet} from "@railgun/logic/RailgunSmartWallet.sol";
import {ShieldRequest, CommitmentPreimage, ShieldCiphertext, TokenData, TokenType} from "@railgun/logic/Globals.sol";

/// @title AxelarPoolRouter
/// @notice Receives an Axelar interchain token transfer and shields the bridged
///         tokens into a RAILGUN pool on behalf of a 0zk recipient.
contract AxelarPoolRouter is AccessControl, InterchainTokenExecutable {
    using SafeERC20 for IERC20;

    bytes32 public constant ALLOW_LIST_MODIFIER_ROLE = keccak256("ALLOW_LIST_MODIFIER_ROLE");

    RailgunSmartWallet public immutable pool;
    mapping(bytes => bool) public allowList;

    struct ShieldNoteData {
        bytes32 npk;
        ShieldCiphertext ciphertext;
    }

    constructor(address interchainTokenService_, RailgunSmartWallet _pool)
        InterchainTokenExecutable(interchainTokenService_)
    {
        pool = _pool;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(ALLOW_LIST_MODIFIER_ROLE, msg.sender);
    }

    /// @notice Shields the received interchain token into the pool. Builds the
    ///         ShieldRequest from the delivered `_token`/`_amount` and the
    ///         recipient fields in `_data`, then forwards it to pool.shield().
    function _executeWithInterchainToken(
        bytes32, /* _commandId */
        string calldata, /* _sourceChain */
        bytes calldata _sourceAddress,
        bytes calldata _data,
        bytes32, /* _tokenId */
        address _token,
        uint256 _amount
    ) internal override {
        // RAILGUN note values are uint120; a 0 value fails shield() validation.
        require(_amount > 0, "AxelarPoolRouter: zero amount");
        require(_amount <= type(uint120).max, "AxelarPoolRouter: amount too large");
        require(allowList[_sourceAddress], "Depositing address is not allowed");

        ShieldNoteData memory note = abi.decode(_data, (ShieldNoteData));

        ShieldRequest[] memory requests = new ShieldRequest[](1);
        requests[0] = ShieldRequest({
            preimage: CommitmentPreimage({
                npk: note.npk,
                token: TokenData({tokenType: TokenType.ERC20, tokenAddress: _token, tokenSubID: 0}),
                // safe: bounded by the require above.
                // forge-lint: disable-next-line(unsafe-typecast)
                value: uint120(_amount)
            }),
            ciphertext: note.ciphertext
        });

        // shield() pulls the full value from msg.sender (this router) via
        // transferFrom; the allowance is consumed back to 0 within the call.
        IERC20(_token).safeApprove(address(pool), _amount);
        pool.shield(requests);
    }

    /// @notice Adds or removes a source address from the allow list
    function setAllowedSourceAddress(bytes calldata sourceAddress, bool allowed) external onlyRole(ALLOW_LIST_MODIFIER_ROLE) {
        allowList[sourceAddress] = allowed;
    }

    function grantRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        super.grantRole(role, account);
    }
}
