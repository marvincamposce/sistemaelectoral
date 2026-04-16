pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * BU-PVP-1 DecryptionVerifier — Phase 9D (foundation)
 *
 * PROVES:
 *   1) Each selection is the decrypted value from the zk-friendly V2 ciphertext lane:
 *        selectionCiphertext = selection + Poseidon(sharedKey, nonce, 0)
 *   2) Published vote counts are the aggregation of decrypted selections.
 *   3) The decryption witness is bound to a compact public commitment.
 *
 * NOTE:
 *   This foundation circuit does NOT yet prove that sharedKey comes from coordinator
 *   private key + ephemeral public key (BabyJub ECDH relation). That step is next.
 */

template IsEqual() {
    signal input a;
    signal input b;
    signal output out;

    signal diff;
    diff <== a - b;

    signal inv;
    inv <-- diff != 0 ? 1 / diff : 0;

    signal isNonZero;
    isNonZero <== diff * inv;

    diff * (1 - isNonZero) === 0;
    isNonZero * (1 - isNonZero) === 0;

    out <== 1 - isNonZero;
}

template RangeCheck(maxVal) {
    signal input val;

    signal prod[maxVal + 2];
    prod[0] <== val;

    for (var k = 1; k <= maxVal; k++) {
        prod[k] <== prod[k - 1] * (val - k);
    }

    prod[maxVal] === 0;
}

template DecryptionVerifier(MAX_BALLOTS, NUM_CANDIDATES) {
    // --- Public inputs ---
    signal input voteCounts[NUM_CANDIDATES];
    signal input totalValid;
    signal output decryptionCommitment;

    // --- Private inputs ---
    signal input activeSlots[MAX_BALLOTS];
    signal input selections[MAX_BALLOTS];
    signal input selectionCiphertexts[MAX_BALLOTS];
    signal input selectionNonces[MAX_BALLOTS];
    signal input selectionSharedKeys[MAX_BALLOTS];

    // 1) Range check selections and decrypt relation check
    component rangeChecks[MAX_BALLOTS];
    component selectionMask[MAX_BALLOTS];
    signal decryptedSelection[MAX_BALLOTS];

    for (var i = 0; i < MAX_BALLOTS; i++) {
        // activeSlots is a selector bit: 1=real ballot, 0=padding slot
        activeSlots[i] * (1 - activeSlots[i]) === 0;

        rangeChecks[i] = RangeCheck(NUM_CANDIDATES);
        rangeChecks[i].val <== selections[i];

        selectionMask[i] = Poseidon(3);
        selectionMask[i].inputs[0] <== selectionSharedKeys[i];
        selectionMask[i].inputs[1] <== selectionNonces[i];
        selectionMask[i].inputs[2] <== 0;

        decryptedSelection[i] <== selectionCiphertexts[i] - selectionMask[i].out;

        // Enforce decryption relation only for active slots.
        (decryptedSelection[i] - selections[i]) * activeSlots[i] === 0;

        // Inactive slots must remain as invalid sentinel (= NUM_CANDIDATES).
        (selections[i] - NUM_CANDIDATES) * (1 - activeSlots[i]) === 0;
    }

    // 2) Count votes per candidate
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

    // 3) totalValid == number of selections strictly below NUM_CANDIDATES
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

    // 4) Bind private decryption witness to a compact public commitment
    signal rollingCommitment[MAX_BALLOTS + 1];
    rollingCommitment[0] <== 0;

    component commitmentHashers[MAX_BALLOTS];
    for (var i = 0; i < MAX_BALLOTS; i++) {
        commitmentHashers[i] = Poseidon(5);
        commitmentHashers[i].inputs[0] <== rollingCommitment[i];
        commitmentHashers[i].inputs[1] <== selectionCiphertexts[i];
        commitmentHashers[i].inputs[2] <== selectionNonces[i];
        commitmentHashers[i].inputs[3] <== selectionSharedKeys[i];
        commitmentHashers[i].inputs[4] <== selections[i];
        rollingCommitment[i + 1] <== commitmentHashers[i].out;
    }

    decryptionCommitment <== rollingCommitment[MAX_BALLOTS];
}

component main {public [voteCounts, totalValid, decryptionCommitment]} = DecryptionVerifier(64, 4);
