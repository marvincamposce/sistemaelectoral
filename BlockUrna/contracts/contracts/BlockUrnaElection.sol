// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BlockUrnaElection is Ownable {
    enum Phase {
        Setup,
        RegistrationOpen,
        VotingOpen,
        VotingClosed
    }

    enum VoterStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    struct Party {
        string name;
        uint256 voteCount;
    }

    Phase public phase;

    Party[] public parties;
    uint256 public totalVotes;

    mapping(address => VoterStatus) public voterStatus;
    mapping(address => bool) public hasVoted;
    mapping(address => uint256) public votedPartyId;

    address[] private _pendingVoters;
    mapping(address => uint256) private _pendingIndexPlusOne;

    event PartyAdded(uint256 indexed partyId, string name);
    event RegistrationRequested(address indexed voter);
    event VoterApproved(address indexed voter);
    event VoterRejected(address indexed voter);
    event VoteCast(address indexed voter, uint256 indexed partyId);
    event PhaseChanged(Phase previousPhase, Phase newPhase);

    error WrongPhase(Phase expected, Phase actual);
    error InvalidPartyCount(uint256 provided, uint256 minimum);
    error InvalidParty(uint256 partyId);
    error RegistrationNotAllowed(VoterStatus status);
    error VoterNotPending(address voter);
    error VoterNotApproved(address voter);
    error AlreadyVoted(address voter);

    modifier inPhase(Phase requiredPhase) {
        if (phase != requiredPhase) {
            revert WrongPhase(requiredPhase, phase);
        }
        _;
    }

    constructor(string[] memory initialPartyNames) Ownable(msg.sender) {
        if (initialPartyNames.length < 3) {
            revert InvalidPartyCount(initialPartyNames.length, 3);
        }

        for (uint256 i = 0; i < initialPartyNames.length; i++) {
            parties.push(Party({name: initialPartyNames[i], voteCount: 0}));
            emit PartyAdded(i, initialPartyNames[i]);
        }

        phase = Phase.Setup;
    }

    function addParty(string calldata name) external onlyOwner inPhase(Phase.Setup) {
        parties.push(Party({name: name, voteCount: 0}));
        emit PartyAdded(parties.length - 1, name);
    }

    function partyCount() external view returns (uint256) {
        return parties.length;
    }

    function getPendingVoters() external view returns (address[] memory) {
        return _pendingVoters;
    }

    function openRegistration() external onlyOwner inPhase(Phase.Setup) {
        _setPhase(Phase.RegistrationOpen);
    }

    function openVoting() external onlyOwner inPhase(Phase.RegistrationOpen) {
        if (parties.length < 3) {
            revert InvalidPartyCount(parties.length, 3);
        }
        _setPhase(Phase.VotingOpen);
    }

    function closeVoting() external onlyOwner inPhase(Phase.VotingOpen) {
        _setPhase(Phase.VotingClosed);
    }

    function requestRegistration() external inPhase(Phase.RegistrationOpen) {
        VoterStatus status = voterStatus[msg.sender];
        if (status == VoterStatus.Pending || status == VoterStatus.Approved) {
            revert RegistrationNotAllowed(status);
        }

        voterStatus[msg.sender] = VoterStatus.Pending;
        _addPending(msg.sender);

        emit RegistrationRequested(msg.sender);
    }

    function approveVoter(address voter) external onlyOwner inPhase(Phase.RegistrationOpen) {
        if (voterStatus[voter] != VoterStatus.Pending) {
            revert VoterNotPending(voter);
        }

        voterStatus[voter] = VoterStatus.Approved;
        _removePending(voter);

        emit VoterApproved(voter);
    }

    function rejectVoter(address voter) external onlyOwner inPhase(Phase.RegistrationOpen) {
        if (voterStatus[voter] != VoterStatus.Pending) {
            revert VoterNotPending(voter);
        }

        voterStatus[voter] = VoterStatus.Rejected;
        _removePending(voter);

        emit VoterRejected(voter);
    }

    function vote(uint256 partyId) external inPhase(Phase.VotingOpen) {
        if (voterStatus[msg.sender] != VoterStatus.Approved) {
            revert VoterNotApproved(msg.sender);
        }
        if (hasVoted[msg.sender]) {
            revert AlreadyVoted(msg.sender);
        }
        if (partyId >= parties.length) {
            revert InvalidParty(partyId);
        }

        hasVoted[msg.sender] = true;
        votedPartyId[msg.sender] = partyId;
        parties[partyId].voteCount += 1;
        totalVotes += 1;

        emit VoteCast(msg.sender, partyId);
    }

    function _setPhase(Phase newPhase) private {
        Phase prev = phase;
        phase = newPhase;
        emit PhaseChanged(prev, newPhase);
    }

    function _addPending(address voter) private {
        if (_pendingIndexPlusOne[voter] != 0) {
            return;
        }

        _pendingVoters.push(voter);
        _pendingIndexPlusOne[voter] = _pendingVoters.length;
    }

    function _removePending(address voter) private {
        uint256 indexPlusOne = _pendingIndexPlusOne[voter];
        if (indexPlusOne == 0) {
            return;
        }

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _pendingVoters.length - 1;

        if (index != lastIndex) {
            address lastVoter = _pendingVoters[lastIndex];
            _pendingVoters[index] = lastVoter;
            _pendingIndexPlusOne[lastVoter] = index + 1;
        }

        _pendingVoters.pop();
        delete _pendingIndexPlusOne[voter];
    }
}
