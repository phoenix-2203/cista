// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CistaVerifier
/// @notice Checks a Cista payslip claim on chain, so another contract (a lending
///         pool, a rental deposit, a payroll-backed credit line) can trust it
///         without trusting Cista, its server or the person submitting it:
///
///         1. the employer signed the pay run with the ML-DSA-87 key registered
///            for their account (QoreChain's PQC Key Status precompile 0x…0a02
///            gives the key, the PQC Verify precompile 0x…0a01 checks it);
///         2. every field shown (its name, value and salt) is in one payslip of
///            that run (salted SHA-256 commitments, two Merkle trees).
///
///         It holds nothing, stores nothing, has no owner and can't be paused.
///         Every check is a view: a caller pays only for its own transaction.
/// @dev Byte-for-byte the same construction as @phoenix-2203/cista (run.ts,
///      commit.ts, merkle.ts, sign.ts); shared test vectors keep them in step.
///      QoreX's signArbitrary signs ML-DSA-87 (FIPS 204, empty context) over
///      "qorechain-msg-v1|" + chainId + "|" + the statement text.
contract CistaVerifier {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;
    uint256 internal constant MAX_DEPTH = 16;

    /// A pay run as the employer signed it (see runStatement).
    struct RunHeader {
        string chainId;
        /// The employer's qor1 address, as written in the statement.
        string employer;
        /// YYYY-MM
        string period;
        uint256 count;
        uint256 totalPayout;
        string denom;
        bytes32 runRoot;
    }

    /// One payslip field the employee chose to show.
    struct Field {
        string name;
        string value;
        bytes32 salt;
        uint256 index;
        bytes32[] siblings;
    }

    error PrecompileInactive();
    error NoRegisteredKey(address account);
    error BadSignature();
    error BadAddress();
    error BadProof();
    error NoEmployeeField();

    // ---------------------------------------------------------------- run

    /// @notice The exact text the employer signed in QoreX.
    function runStatement(RunHeader calldata h) public pure returns (bytes memory) {
        return abi.encodePacked(
            "Cista pay run v1\nChain: ", h.chainId,
            "\nEmployer: ", h.employer,
            "\nPeriod: ", h.period,
            "\nPayslips: ", _decimal(h.count),
            "\nTotal payout: ", _decimal(h.totalPayout), h.denom,
            "\nRun root: ", _hex(h.runRoot)
        );
    }

    /// @notice The bytes the ML-DSA-87 key signs for that statement.
    function signedBytes(RunHeader calldata h) public pure returns (bytes memory) {
        return abi.encodePacked("qorechain-msg-v1|", h.chainId, "|", runStatement(h));
    }

    /// @notice Checks the employer's ML-DSA-87 signature over the run against
    ///         the key registered on chain for the employer's account.
    /// @return employer the employer's account (the 20 bytes of its qor1 address)
    function verifyRun(RunHeader calldata h, bytes calldata pqSignature) public view returns (address employer) {
        employer = parseQorAddress(h.employer);
        bytes memory pubkey = _registeredKey(employer);
        (bool ok, bytes memory ret) =
            PQC_VERIFY.staticcall(abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pubkey, pqSignature, signedBytes(h)));
        if (!ok || ret.length < 32) revert PrecompileInactive();
        if (!abi.decode(ret, (bool))) revert BadSignature();
    }

    // ------------------------------------------------------------- fields

    /// @notice Checks the run's signature and that every field comes from one
    ///         payslip in it. The fields must include "employee.address".
    /// @return employer the employer's account
    /// @return employee the account the payslip belongs to
    function verifyFields(
        RunHeader calldata h,
        bytes calldata pqSignature,
        uint256 slipIndex,
        bytes32[] calldata slipSiblings,
        Field[] calldata fields
    ) external view returns (address employer, address employee) {
        employer = verifyRun(h, pqSignature);
        if (fields.length == 0) revert BadProof();
        bytes32 fieldsRoot;
        bool found;
        for (uint256 i = 0; i < fields.length; i++) {
            Field calldata f = fields[i];
            bytes32 root = rootFromProof(fieldCommitment(f.name, f.value, f.salt), f.index, f.siblings);
            if (i == 0) fieldsRoot = root;
            else if (root != fieldsRoot) revert BadProof();
            if (keccak256(bytes(f.name)) == keccak256("employee.address")) {
                employee = parseQorAddress(f.value);
                found = true;
            }
        }
        if (!found) revert NoEmployeeField();
        bytes32 slipRoot = sha256(abi.encodePacked("cista/slip/v1", fieldsRoot));
        if (rootFromProof(slipRoot, slipIndex, slipSiblings) != h.runRoot) revert BadProof();
    }

    /// SHA-256("cista/field/v1" || len(name) || name || len(value) || value || salt), lengths as 4-byte big-endian.
    function fieldCommitment(string calldata name, string calldata value, bytes32 salt) public pure returns (bytes32) {
        return sha256(
            abi.encodePacked("cista/field/v1", uint32(bytes(name).length), name, uint32(bytes(value).length), value, salt)
        );
    }

    /// Leaf = SHA-256(0x00 || value), node = SHA-256(0x01 || left || right).
    function rootFromProof(bytes32 value, uint256 index, bytes32[] calldata siblings) public pure returns (bytes32 hash) {
        if (siblings.length > MAX_DEPTH || index >> siblings.length != 0) revert BadProof();
        hash = sha256(abi.encodePacked(bytes1(0x00), value));
        for (uint256 i = 0; i < siblings.length; i++) {
            hash = (index >> i) & 1 == 1
                ? sha256(abi.encodePacked(bytes1(0x01), siblings[i], hash))
                : sha256(abi.encodePacked(bytes1(0x01), hash, siblings[i]));
        }
    }

    // ----------------------------------------------------------- addresses

    /// @notice A qor1 bech32 address (checksum checked) to its 20-byte account.
    function parseQorAddress(string calldata s) public pure returns (address) {
        bytes calldata b = bytes(s);
        // "qor1" + 32 data characters + 6 checksum characters
        if (b.length != 42 || b[0] != "q" || b[1] != "o" || b[2] != "r" || b[3] != "1") revert BadAddress();
        uint256 chk = 1;
        // hrp expansion of "qor": high bits (3, 3, 3), a zero, low bits (17, 15, 18)
        chk = _polymodStep(chk, 3);
        chk = _polymodStep(chk, 3);
        chk = _polymodStep(chk, 3);
        chk = _polymodStep(chk, 0);
        chk = _polymodStep(chk, 17);
        chk = _polymodStep(chk, 15);
        chk = _polymodStep(chk, 18);
        uint256 acc;
        uint256 bits;
        uint160 out;
        uint256 outLen;
        for (uint256 i = 4; i < 42; i++) {
            uint256 v = _charValue(uint8(b[i]));
            chk = _polymodStep(chk, v);
            if (i < 36) {
                acc = (acc << 5) | v;
                bits += 5;
                if (bits >= 8) {
                    bits -= 8;
                    out = (out << 8) | uint160((acc >> bits) & 0xff);
                    outLen++;
                }
            }
        }
        if (chk != 1 || outLen != 20 || (acc & ((1 << bits) - 1)) != 0) revert BadAddress();
        return address(out);
    }

    // ------------------------------------------------------------ internal

    function _registeredKey(address account) internal view returns (bytes memory pubkey) {
        (bool ok, bytes memory ret) = PQC_KEY_STATUS.staticcall(abi.encodeWithSignature("pqcKeyStatus(address)", account));
        // four head words plus the length word of the (possibly empty) key
        if (!ok || ret.length < 160) revert PrecompileInactive();
        bool registered;
        (registered,, pubkey,) = abi.decode(ret, (bool, uint8, bytes, bool));
        if (!registered || pubkey.length == 0) revert NoRegisteredKey(account);
    }

    function _polymodStep(uint256 chk, uint256 v) private pure returns (uint256) {
        uint256 top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        if (top & 1 != 0) chk ^= 0x3b6a57b2;
        if (top & 2 != 0) chk ^= 0x26508e6d;
        if (top & 4 != 0) chk ^= 0x1ea119fa;
        if (top & 8 != 0) chk ^= 0x3d4233dd;
        if (top & 16 != 0) chk ^= 0x2a1462b3;
        return chk;
    }

    /// Position of a lowercase bech32 character in "qpzry9x8gf2tvdw0s3jn54khce6mua7l".
    function _charValue(uint8 c) private pure returns (uint256) {
        bytes memory charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
        for (uint256 i = 0; i < 32; i++) {
            if (uint8(charset[i]) == c) return i;
        }
        revert BadAddress();
    }

    function _decimal(uint256 v) private pure returns (bytes memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) len++;
        bytes memory out = new bytes(len);
        for (uint256 i = len; i > 0; i--) {
            out[i - 1] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return out;
    }

    function _hex(bytes32 v) private pure returns (bytes memory out) {
        bytes16 digits = "0123456789abcdef";
        out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            out[2 * i] = digits[uint8(v[i]) >> 4];
            out[2 * i + 1] = digits[uint8(v[i]) & 0x0f];
        }
    }
}
