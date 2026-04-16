// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool);
}

/// @title BU-PVP-1 Tally Verifier
/// @notice Wraps Groth16 proof verification and emits an immutable on-chain verification event.
contract BU_PVP_1_TallyVerifier {
    error InvalidVerifierAddress();
    error InvalidProof();
    error EmptyJobId();

    address public immutable groth16Verifier;

    event TallyProofVerifiedOnChain(
        uint256 indexed electionId,
        bytes32 indexed jobIdHash,
        bytes32 indexed proofHash,
        bytes32 publicInputsHash,
        address verifierContract
    );

    constructor(address verifierAddress) {
        if (verifierAddress == address(0)) {
            revert InvalidVerifierAddress();
        }
        groth16Verifier = verifierAddress;
    }

    function verifyTallyProof(
        uint256 electionId,
        string calldata jobId,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external returns (bool) {
        if (bytes(jobId).length == 0) {
            revert EmptyJobId();
        }

        bool valid = IGroth16Verifier(groth16Verifier).verifyProof(a, b, c, input);
        if (!valid) {
            revert InvalidProof();
        }

        emit TallyProofVerifiedOnChain(
            electionId,
            keccak256(bytes(jobId)),
            keccak256(abi.encode(a, b, c)),
            keccak256(abi.encode(input)),
            groth16Verifier
        );

        return true;
    }
}
