// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Test stand-ins for QoreChain's PQC precompiles, placed at 0x…0a01 and
/// 0x…0a02 in the test EVM. The verify mock can't run ML-DSA-87 itself, so the
/// test computes a real ML-DSA-87 signature in TypeScript and allows exactly
/// that (key, signature, message) triple: a contract that asks about any other
/// message bytes gets "false". That pins the message bytes the contract builds.
contract MockPqcVerify {
    mapping(bytes32 => bool) public allowed;

    function allow(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external {
        allowed[keccak256(abi.encode(pubkey, signature, message))] = true;
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external view returns (bool) {
        return allowed[keccak256(abi.encode(pubkey, signature, message))];
    }
}

contract MockPqcKeyStatus {
    mapping(address => bytes) internal keys;

    function set(address account, bytes calldata pubkey) external {
        keys[account] = pubkey;
    }

    function pqcKeyStatus(address account) external view returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven) {
        pubkey = keys[account];
        registered = pubkey.length > 0;
        algorithmId = registered ? 1 : 0;
        possessionProven = registered;
    }
}
