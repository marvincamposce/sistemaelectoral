pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * BU-PVP-1 TallyVerifier — Phase 9B Merkle Inclusion Circuit
 *
 * PROVES: "The published vote counts per candidate are the correct
 *          aggregation of individual ballot selections."
 *
 * Parameters (compile-time):
 *   MAX_BALLOTS    = 64   — maximum number of ballots in the election
 *   NUM_CANDIDATES = 4    — number of candidates on the ballot
 *
 * Public inputs (6 signals):
 *   voteCounts[NUM_CANDIDATES] — published vote count per candidate
 *   totalValid                 — total number of valid ballots
 *   merkleRoot                 — Poseidon Merkle root over ballot hashes
 *
 * Private inputs (MAX_BALLOTS signals):
 *   selections[MAX_BALLOTS]    — each ballot's selection:
 *                                 0..NUM_CANDIDATES-1 = valid candidate vote
 *                                 NUM_CANDIDATES      = invalid/unused slot
 *
 * Additional private inputs (Phase 9B):
 *   ballotHashes[MAX_BALLOTS]              — leaf per slot (field element)
 *   merkleProofs[MAX_BALLOTS][MERKLE_DEPTH] — sibling path to root
 *   merklePathIndices[MAX_BALLOTS][MERKLE_DEPTH] — 0 if current node is left, 1 if right
 *
 * Constraints:
 *   1) Each selection ∈ {0, 1, ..., NUM_CANDIDATES}
 *   2) Count of selections matching candidate j == voteCounts[j]
 *   3) Count of valid selections (< NUM_CANDIDATES) == totalValid
 *   4) Every ballot hash belongs to the published Merkle root
 */

// IsEqual: outputs 1 if a == b, else 0
// Uses the standard trick: if a != b then (a-b) has an inverse.
template IsEqual() {
    signal input a;
    signal input b;
    signal output out;

    signal diff;
    diff <== a - b;

    // If diff is 0, then inv is 0 (doesn't matter, constrained below).
    // If diff is nonzero, inv is its inverse in the field.
    signal inv;
    inv <-- diff != 0 ? 1 / diff : 0;

    // isNonZero is 1 if diff != 0
    signal isNonZero;
    isNonZero <== diff * inv;

    // Ensure diff * (1 - isNonZero) == 0
    // If diff != 0, then isNonZero must be 1 (so (1-1)*diff = 0 ✓)
    // If diff == 0, then isNonZero can be 0 or 1, but next line locks it.
    diff * (1 - isNonZero) === 0;

    // Ensure isNonZero * (1 - isNonZero) == 0 => isNonZero ∈ {0,1}
    isNonZero * (1 - isNonZero) === 0;

    out <== 1 - isNonZero;
}

// RangeCheck: constrains val ∈ {0, 1, ..., maxVal}
// Works by checking that val equals at least one value in the range.
template RangeCheck(maxVal) {
    signal input val;

    // Compute product ∏(val - k) for k = 0..maxVal.
    // This product is 0 iff val ∈ {0, ..., maxVal}.
    // We build it iteratively to keep the constraint degree manageable.

    signal prod[maxVal + 2];
    prod[0] <== val; // (val - 0)

    for (var k = 1; k <= maxVal; k++) {
        prod[k] <== prod[k - 1] * (val - k);
    }

    // Final product must be 0
    prod[maxVal] === 0;
}

template MerkleProofVerifier(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];
    signal output root;

    signal levelHash[DEPTH + 1];
    levelHash[0] <== leaf;

    component hasher[DEPTH];
    signal leftInput[DEPTH];
    signal rightInput[DEPTH];

    for (var d = 0; d < DEPTH; d++) {
        // path index must be a bit
        pathIndices[d] * (1 - pathIndices[d]) === 0;

        // If pathIndices[d] == 0: current hash is left child
        // If pathIndices[d] == 1: current hash is right child
        leftInput[d] <== levelHash[d] + pathIndices[d] * (pathElements[d] - levelHash[d]);
        rightInput[d] <== pathElements[d] + pathIndices[d] * (levelHash[d] - pathElements[d]);

        hasher[d] = Poseidon(2);
        hasher[d].inputs[0] <== leftInput[d];
        hasher[d].inputs[1] <== rightInput[d];
        levelHash[d + 1] <== hasher[d].out;
    }

    root <== levelHash[DEPTH];
}

// Main circuit
template TallyVerifier(MAX_BALLOTS, NUM_CANDIDATES) {
    var MERKLE_DEPTH = 6;

    // --- Public inputs ---
    signal input voteCounts[NUM_CANDIDATES];
    signal input totalValid;
    signal input merkleRoot;

    // --- Private inputs ---
    signal input selections[MAX_BALLOTS];
    signal input ballotHashes[MAX_BALLOTS];
    signal input merkleProofs[MAX_BALLOTS][MERKLE_DEPTH];
    signal input merklePathIndices[MAX_BALLOTS][MERKLE_DEPTH];

    // 1) Range check: each selection must be in {0, ..., NUM_CANDIDATES}
    //    (value NUM_CANDIDATES means "invalid/unused")
    component rangeChecks[MAX_BALLOTS];
    for (var i = 0; i < MAX_BALLOTS; i++) {
        rangeChecks[i] = RangeCheck(NUM_CANDIDATES);
        rangeChecks[i].val <== selections[i];
    }

    // 2) Count votes per candidate
    //    For each candidate j, count how many selections[i] == j
    component isCandidate[MAX_BALLOTS][NUM_CANDIDATES];
    signal candidateMatch[MAX_BALLOTS][NUM_CANDIDATES];

    for (var i = 0; i < MAX_BALLOTS; i++) {
        for (var j = 0; j < NUM_CANDIDATES; j++) {
            isCandidate[i][j] = IsEqual();
            isCandidate[i][j].a <== selections[i];
            isCandidate[i][j].b <== j;
            candidateMatch[i][j] <== isCandidate[i][j].out;
        }
    }

    // Sum matches per candidate and constrain to public voteCounts
    signal partialSum[MAX_BALLOTS + 1][NUM_CANDIDATES];
    for (var j = 0; j < NUM_CANDIDATES; j++) {
        partialSum[0][j] <== 0;
    }
    for (var i = 0; i < MAX_BALLOTS; i++) {
        for (var j = 0; j < NUM_CANDIDATES; j++) {
            partialSum[i + 1][j] <== partialSum[i][j] + candidateMatch[i][j];
        }
    }

    for (var j = 0; j < NUM_CANDIDATES; j++) {
        partialSum[MAX_BALLOTS][j] === voteCounts[j];
    }

    // 3) Count valid ballots (selections < NUM_CANDIDATES)
    //    A selection is valid iff it's NOT equal to NUM_CANDIDATES
    component isInvalid[MAX_BALLOTS];
    signal validBit[MAX_BALLOTS];
    signal validSum[MAX_BALLOTS + 1];
    validSum[0] <== 0;

    for (var i = 0; i < MAX_BALLOTS; i++) {
        isInvalid[i] = IsEqual();
        isInvalid[i].a <== selections[i];
        isInvalid[i].b <== NUM_CANDIDATES;
        validBit[i] <== 1 - isInvalid[i].out;
        validSum[i + 1] <== validSum[i] + validBit[i];
    }

    validSum[MAX_BALLOTS] === totalValid;

    // 4) Verify each ballot hash is included in the published Merkle root
    component merkleVerifiers[MAX_BALLOTS];
    for (var i = 0; i < MAX_BALLOTS; i++) {
        merkleVerifiers[i] = MerkleProofVerifier(MERKLE_DEPTH);
        merkleVerifiers[i].leaf <== ballotHashes[i];

        for (var d = 0; d < MERKLE_DEPTH; d++) {
            merkleVerifiers[i].pathElements[d] <== merkleProofs[i][d];
            merkleVerifiers[i].pathIndices[d] <== merklePathIndices[i][d];
        }

        merkleVerifiers[i].root === merkleRoot;
    }
}

// Instantiate with concrete parameters
component main {public [voteCounts, totalValid, merkleRoot]} = TallyVerifier(64, 4);
