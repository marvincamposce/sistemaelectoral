// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IGroth16DecryptionVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool);
}

interface IElectionRegistryDecryptionRecorder {
    function recordDecryptionProofVerification(uint256 electionId) external;
}

/// @title BU-PVP-1 Decryption Verifier
/// @notice Wraps Groth16 decryption-proof verification and records immutable on-chain verification.
contract BU_PVP_1_DecryptionVerifier {
    error InvalidVerifierAddress();
    error InvalidRegistryAddress();
    error InvalidProof();
    error EmptyJobId();

    address public immutable groth16Verifier;
    address public immutable electionRegistry;

    event DecryptionProofVerifiedOnChain(
        uint256 indexed electionId,
        bytes32 indexed jobIdHash,
        bytes32 indexed proofHash,
        bytes32 publicInputsHash,
        address verifierContract
    );

    constructor(address verifierAddress, address registryAddress) {
        if (verifierAddress == address(0)) {
            revert InvalidVerifierAddress();
        }
        if (registryAddress == address(0)) {
            revert InvalidRegistryAddress();
        }
        groth16Verifier = verifierAddress;
        electionRegistry = registryAddress;
    }

    function verifyDecryptionProof(
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

        bool valid = IGroth16DecryptionVerifier(groth16Verifier).verifyProof(a, b, c, input);
        if (!valid) {
            revert InvalidProof();
        }

        IElectionRegistryDecryptionRecorder(electionRegistry).recordDecryptionProofVerification(electionId);

        emit DecryptionProofVerifiedOnChain(
            electionId,
            keccak256(bytes(jobId)),
            keccak256(abi.encode(a, b, c)),
            keccak256(abi.encode(input)),
            groth16Verifier
        );

        return true;
    }
}
