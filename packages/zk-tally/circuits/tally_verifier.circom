pragma circom 2.1.0;

/*
 * BU-PVP-1 TallyVerifier — Phase 9A Minimal Viable ZK Circuit
 *
 * PROVES: "The published vote counts per candidate are the correct
 *          aggregation of individual ballot selections."
 *
 * Parameters (compile-time):
 *   MAX_BALLOTS    = 64   — maximum number of ballots in the election
 *   NUM_CANDIDATES = 4    — number of candidates on the ballot
 *
 * Public inputs (5 signals):
 *   voteCounts[NUM_CANDIDATES] — published vote count per candidate
 *   totalValid                 — total number of valid ballots
 *
 * Private inputs (MAX_BALLOTS signals):
 *   selections[MAX_BALLOTS]    — each ballot's selection:
 *                                 0..NUM_CANDIDATES-1 = valid candidate vote
 *                                 NUM_CANDIDATES      = invalid/unused slot
 *
 * Constraints:
 *   1) Each selection ∈ {0, 1, ..., NUM_CANDIDATES}
 *   2) Count of selections matching candidate j == voteCounts[j]
 *   3) Count of valid selections (< NUM_CANDIDATES) == totalValid
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

// Main circuit
template TallyVerifier(MAX_BALLOTS, NUM_CANDIDATES) {
    // --- Public inputs ---
    signal input voteCounts[NUM_CANDIDATES];
    signal input totalValid;

    // --- Private inputs ---
    signal input selections[MAX_BALLOTS];

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
}

// Instantiate with concrete parameters
component main {public [voteCounts, totalValid]} = TallyVerifier(64, 4);
