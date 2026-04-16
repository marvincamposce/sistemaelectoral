// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title BU-PVP-1 Election Registry (TPE core)
/// @notice Research reference implementation: phase machine + evidence events + acta anchoring.
/// @dev Proof verification is stubbed behind verifier interfaces; production requires real verifiers.
contract BU_PVP_1_ElectionRegistry is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    enum Phase {
        SETUP,
        REGISTRY_OPEN,
        REGISTRY_CLOSED,
        VOTING_OPEN,
        VOTING_CLOSED,
        PROCESSING,
        TALLYING,
        RESULTS_PUBLISHED,
        AUDIT_WINDOW,
        ARCHIVED
    }

    enum ActaKind {
        ACTA_APERTURA,
        ACTA_CIERRE,
        ACTA_ESCRUTINIO,
        ACTA_RESULTADOS
    }

    struct Election {
        bytes32 manifestHash;
        address authority; // AEA for this election
        address registryAuthority; // REA signer (ECDSA)
        bytes coordinatorPubKey; // public key used for ballot encryption
        Phase phase;
        uint64 createdAtBlock;
    }

    Election[] private _elections;

    // electionId => nullifier used
    mapping(uint256 => mapping(bytes32 => bool)) public registryNullifierUsed;
    // electionId => voting address registered from signup
    mapping(uint256 => mapping(address => bool)) public votingAddressRegistered;
    // electionId => voting address already cast a ballot
    mapping(uint256 => mapping(address => bool)) public ballotCastByVotingAddress;

    // electionId => counters
    mapping(uint256 => uint256) public signupCount;
    mapping(uint256 => uint256) public ballotCount;

    event ElectionCreated(
        uint256 indexed electionId,
        bytes32 indexed manifestHash,
        address indexed authority,
        address registryAuthority,
        bytes coordinatorPubKey
    );

    event PhaseChanged(uint256 indexed electionId, Phase previousPhase, Phase newPhase);

    event SignupRecorded(
        uint256 indexed electionId,
        bytes32 indexed registryNullifier,
        bytes votingPubKey
    );

    event BallotPublished(
        uint256 indexed electionId,
        uint256 indexed ballotIndex,
        bytes32 indexed ballotHash,
        bytes ciphertext
    );

    event ActaPublished(
        uint256 indexed electionId,
        ActaKind kind,
        bytes32 indexed snapshotHash
    );

    event TallyProofPublished(
        uint256 indexed electionId,
        bytes32 indexed proofHash,
        bytes proofPayload
    );

    error NotElectionAuthority(uint256 electionId, address caller);
    error WrongPhase(uint256 electionId, Phase expected, Phase actual);
    error RegistryNullifierAlreadyUsed(uint256 electionId, bytes32 nullifier);
    error InvalidRegistryPermit(uint256 electionId, bytes32 nullifier);
    error InvalidVotingPubKey();
    error VotingAddressAlreadyRegistered(uint256 electionId, address votingAddress);
    error VotingAddressNotRegistered(uint256 electionId, address votingAddress);
    error BallotAlreadyCast(uint256 electionId, address votingAddress);
    error InvalidBallotSignature(uint256 electionId, address votingAddress);

    modifier onlyElectionAuthority(uint256 electionId) {
        if (_elections[electionId].authority != msg.sender) {
            revert NotElectionAuthority(electionId, msg.sender);
        }
        _;
    }

    modifier inPhase(uint256 electionId, Phase expected) {
        Phase actual = _elections[electionId].phase;
        if (actual != expected) {
            revert WrongPhase(electionId, expected, actual);
        }
        _;
    }

    constructor() Ownable(msg.sender) {}

    function electionCount() external view returns (uint256) {
        return _elections.length;
    }

    function getElection(uint256 electionId) external view returns (Election memory) {
        return _elections[electionId];
    }

    /// @notice Creates an election (SETUP)
    function createElection(
        bytes32 manifestHash,
        address registryAuthority,
        bytes calldata coordinatorPubKey
    ) external returns (uint256 electionId) {
        electionId = _elections.length;
        _elections.push(
            Election({
                manifestHash: manifestHash,
                authority: msg.sender,
                registryAuthority: registryAuthority,
                coordinatorPubKey: coordinatorPubKey,
                phase: Phase.SETUP,
                createdAtBlock: uint64(block.number)
            })
        );

        emit ElectionCreated(
            electionId,
            manifestHash,
            msg.sender,
            registryAuthority,
            coordinatorPubKey
        );
    }

    function openRegistry(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.SETUP)
    {
        _setPhase(electionId, Phase.REGISTRY_OPEN);
    }

    function closeRegistry(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.REGISTRY_OPEN)
    {
        _setPhase(electionId, Phase.REGISTRY_CLOSED);
    }

    function openVoting(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.REGISTRY_CLOSED)
    {
        _setPhase(electionId, Phase.VOTING_OPEN);
    }

    function closeVoting(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.VOTING_OPEN)
    {
        _setPhase(electionId, Phase.VOTING_CLOSED);
    }

    function startProcessing(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.VOTING_CLOSED)
    {
        _setPhase(electionId, Phase.PROCESSING);
    }

    function finalizeProcessing(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.PROCESSING)
    {
        _setPhase(electionId, Phase.TALLYING);
    }

    function publishResults(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.TALLYING)
    {
        _setPhase(electionId, Phase.RESULTS_PUBLISHED);
    }

    function openAuditWindow(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.RESULTS_PUBLISHED)
    {
        _setPhase(electionId, Phase.AUDIT_WINDOW);
    }

    function archiveElection(uint256 electionId)
        external
        onlyElectionAuthority(electionId)
        inPhase(electionId, Phase.AUDIT_WINDOW)
    {
        _setPhase(electionId, Phase.ARCHIVED);
    }

    /// @notice Records a signup (eligibility exercised) using an REA permit signature.
    /// @dev permitSig is an ECDSA signature over (electionId, nullifier).
    function signup(
        uint256 electionId,
        bytes32 registryNullifier,
        bytes calldata votingPubKey,
        bytes calldata permitSig
    ) external inPhase(electionId, Phase.REGISTRY_OPEN) {
        if (registryNullifierUsed[electionId][registryNullifier]) {
            revert RegistryNullifierAlreadyUsed(electionId, registryNullifier);
        }

        bytes32 digest = keccak256(abi.encodePacked("BU-PVP-1:signup", electionId, registryNullifier));
        address signer = digest.toEthSignedMessageHash().recover(permitSig);
        if (signer != _elections[electionId].registryAuthority) {
            revert InvalidRegistryPermit(electionId, registryNullifier);
        }

        address votingAddress = _deriveVotingAddress(votingPubKey);
        if (votingAddressRegistered[electionId][votingAddress]) {
            revert VotingAddressAlreadyRegistered(electionId, votingAddress);
        }

        registryNullifierUsed[electionId][registryNullifier] = true;
        votingAddressRegistered[electionId][votingAddress] = true;
        signupCount[electionId] += 1;
        emit SignupRecorded(electionId, registryNullifier, votingPubKey);
    }

    /// @notice Publishes an encrypted ballot message tied to a prior signup.
    /// @dev The ballot must be signed by the ephemeral voting key registered during signup.
    function publishBallot(
        uint256 electionId,
        bytes calldata votingPubKey,
        bytes calldata ciphertext,
        bytes calldata ballotSig
    ) external inPhase(electionId, Phase.VOTING_OPEN) {
        address votingAddress = _deriveVotingAddress(votingPubKey);
        _ensureVotingAddressEligible(electionId, votingAddress);
        _verifyBallotSignature(electionId, votingAddress, ciphertext, ballotSig);

        uint256 index = ballotCount[electionId];
        bytes32 ballotHash = keccak256(ciphertext);
        ballotCastByVotingAddress[electionId][votingAddress] = true;
        ballotCount[electionId] = index + 1;
        emit BallotPublished(electionId, index, ballotHash, ciphertext);
    }

    /// @notice Anchors a signed acta (snapshot) by hash.
    /// @dev Signature verification is performed by observers/auditors off-chain; on-chain stores only the hash.
    function publishActa(
        uint256 electionId,
        ActaKind kind,
        bytes32 snapshotHash
    ) external onlyElectionAuthority(electionId) {
        emit ActaPublished(electionId, kind, snapshotHash);
    }

    /// @notice Publishes a tally proof / batch proof stub.
    /// @dev In full ZK implementations, this is parsed by a verifier. Currently an abstract evidence stub.
    function publishTallyProof(
        uint256 electionId,
        bytes calldata proofPayload
    ) external onlyElectionAuthority(electionId) inPhase(electionId, Phase.TALLYING) {
        bytes32 proofHash = keccak256(proofPayload);
        emit TallyProofPublished(electionId, proofHash, proofPayload);
    }

    function _setPhase(uint256 electionId, Phase newPhase) private {
        Phase prev = _elections[electionId].phase;
        _elections[electionId].phase = newPhase;
        emit PhaseChanged(electionId, prev, newPhase);
    }

    function _deriveVotingAddress(bytes calldata votingPubKey) private pure returns (address) {
        if (votingPubKey.length != 65 || votingPubKey[0] != 0x04) {
            revert InvalidVotingPubKey();
        }

        bytes memory rawKey = new bytes(64);
        for (uint256 i = 0; i < 64; i++) {
            rawKey[i] = votingPubKey[i + 1];
        }

        return address(uint160(uint256(keccak256(rawKey))));
    }

    function _ensureVotingAddressEligible(uint256 electionId, address votingAddress) private view {
        if (!votingAddressRegistered[electionId][votingAddress]) {
            revert VotingAddressNotRegistered(electionId, votingAddress);
        }
        if (ballotCastByVotingAddress[electionId][votingAddress]) {
            revert BallotAlreadyCast(electionId, votingAddress);
        }
    }

    function _verifyBallotSignature(
        uint256 electionId,
        address votingAddress,
        bytes calldata ciphertext,
        bytes calldata ballotSig
    ) private pure {
        bytes32 ballotDigest = keccak256(
            abi.encodePacked("BU-PVP-1:ballot", electionId, keccak256(ciphertext))
        );
        address recovered = ballotDigest.toEthSignedMessageHash().recover(ballotSig);
        if (recovered != votingAddress) {
            revert InvalidBallotSignature(electionId, votingAddress);
        }
    }
}
