// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Pairing {
    uint256 internal constant PRIME_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    struct G1Point {
        uint256 X;
        uint256 Y;
    }

    struct G2Point {
        uint256[2] X;
        uint256[2] Y;
    }

    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.X == 0 && p.Y == 0) {
            return G1Point(0, 0);
        }
        return G1Point(p.X, PRIME_Q - (p.Y % PRIME_Q));
    }

    function addition(
        G1Point memory p1,
        G1Point memory p2
    ) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.X;
        input[1] = p1.Y;
        input[2] = p2.X;
        input[3] = p2.Y;

        bool success;
        assembly {
            success := staticcall(gas(), 6, input, 0x80, r, 0x40)
        }
        require(success, "pairing-add-failed");
    }

    function scalar_mul(
        G1Point memory p,
        uint256 s
    ) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.X;
        input[1] = p.Y;
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 7, input, 0x60, r, 0x40)
        }
        require(success, "pairing-mul-failed");
    }

    function pairing(
        G1Point[] memory p1,
        G2Point[] memory p2
    ) internal view returns (bool) {
        require(p1.length == p2.length, "pairing-length-mismatch");

        uint256 elements = p1.length;
        uint256 inputSize = elements * 6;
        uint256[] memory input = new uint256[](inputSize);

        for (uint256 i = 0; i < elements; i++) {
            uint256 offset = i * 6;
            input[offset] = p1[i].X;
            input[offset + 1] = p1[i].Y;
            input[offset + 2] = p2[i].X[0];
            input[offset + 3] = p2[i].X[1];
            input[offset + 4] = p2[i].Y[0];
            input[offset + 5] = p2[i].Y[1];
        }

        uint256[1] memory out;
        bool success;
        assembly {
            success := staticcall(
                gas(),
                8,
                add(input, 0x20),
                mul(inputSize, 0x20),
                out,
                0x20
            )
        }

        require(success, "pairing-opcode-failed");
        return out[0] != 0;
    }

    function pairingProd4(
        G1Point memory a1,
        G2Point memory a2,
        G1Point memory b1,
        G2Point memory b2,
        G1Point memory c1,
        G2Point memory c2,
        G1Point memory d1,
        G2Point memory d2
    ) internal view returns (bool) {
        G1Point[] memory p1 = new G1Point[](4);
        G2Point[] memory p2 = new G2Point[](4);

        p1[0] = a1;
        p1[1] = b1;
        p1[2] = c1;
        p1[3] = d1;

        p2[0] = a2;
        p2[1] = b2;
        p2[2] = c2;
        p2[3] = d2;

        return pairing(p1, p2);
    }
}

contract Groth16Verifier {
    uint256 internal constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant INPUT_COUNT = 6;

    struct VerifyingKey {
        Pairing.G1Point alfa1;
        Pairing.G2Point beta2;
        Pairing.G2Point gamma2;
        Pairing.G2Point delta2;
        Pairing.G1Point[] IC;
    }

    struct Proof {
        Pairing.G1Point A;
        Pairing.G2Point B;
        Pairing.G1Point C;
    }

    error InvalidPublicInputLength(uint256 expected, uint256 received);
    error PublicInputOutOfRange(uint256 index);

    function verifyingKey() internal pure returns (VerifyingKey memory vk) {
        vk.alfa1 = Pairing.G1Point(uint256(20340485977453946931396746017848151750532578614717065891760804360675235114206), uint256(5020487795923337090042547809206964299965095403350555628259206901191174319361));
        vk.beta2 = Pairing.G2Point([uint256(3786118011763491338259974133547319464905002037377824236170693382397767380493), uint256(4632608908714062922392427415951481063004186653293987718216473624347267169383)], [uint256(9263343923713367332235763703824641253514648274406960152050023592067471275301), uint256(17306684874990362687264583957705083194706717088960252984857750584558154594937)]);
        vk.gamma2 = Pairing.G2Point([uint256(13938283985489848097402827377438575278149179468099881751170192642905339298388), uint256(8699567465856517689988187395602514592110674697550326888321134759077362189881)], [uint256(5287760584734877417715680811986823209935487856360580387818953709299036176764), uint256(20930771532122905565516493598088330113766698576589998647383398923163253517585)]);
        vk.delta2 = Pairing.G2Point([uint256(953489496633410441635650985214911479937493759480165353165545731682990322277), uint256(9478263967143611182279979881030048726463952626861340415541550776282221686495)], [uint256(18453418885718860735756427866370112978713927127737502283084990385152921711506), uint256(20782275511714385641642522569956059593056491215734532420618727711616235972769)]);
        vk.IC = new Pairing.G1Point[](7);
        vk.IC[0] = Pairing.G1Point(uint256(8457567058392344764959994122032780907956681448666390309885497488008531147236), uint256(5528330436710831736199149319034766092189828516033671283308030284809065951008));
        vk.IC[1] = Pairing.G1Point(uint256(19380055019416906105310707111642614952213410920904720232196902336765501562495), uint256(17448597229470509604831783960142094088832363341738884034390585508623245398196));
        vk.IC[2] = Pairing.G1Point(uint256(7645967121227692815859018979157831345249098090577407873156287580502646556453), uint256(15734369946563727100811176353713928994195123245092624978488712844947630643438));
        vk.IC[3] = Pairing.G1Point(uint256(9833759250848968054152591904122288771066715803874773336125334561329831736857), uint256(5417316413632111939880289867914962025557561251742400180225994428167420151712));
        vk.IC[4] = Pairing.G1Point(uint256(11850193428223765486368416444002996178712311705155191353896107733007487441293), uint256(8747406056061466326804381748279178121503023217330101994685517919910266816863));
        vk.IC[5] = Pairing.G1Point(uint256(7226010762004308705642451481289197947506766696453116198775435951979472663946), uint256(16125284351570326849296059456463425208940224447178740350002380907427123078467));
        vk.IC[6] = Pairing.G1Point(uint256(4561202333924219008477241833947116088398151873277207862449240189377660314306), uint256(13575712315053052366717821095040816766422867622555181400109659646167456895409));
    }


    function _verify(
        uint256[] memory input,
        Proof memory proof
    ) internal view returns (bool) {
        VerifyingKey memory vk = verifyingKey();

        if (input.length + 1 != vk.IC.length) {
            revert InvalidPublicInputLength(vk.IC.length - 1, input.length);
        }

        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint256 i = 0; i < input.length; i++) {
            if (input[i] >= SNARK_SCALAR_FIELD) {
                revert PublicInputOutOfRange(i);
            }
            vk_x = Pairing.addition(vk_x, Pairing.scalar_mul(vk.IC[i + 1], input[i]));
        }
        vk_x = Pairing.addition(vk_x, vk.IC[0]);

        return Pairing.pairingProd4(
            proof.A,
            proof.B,
            Pairing.negate(vk_x),
            vk.gamma2,
            Pairing.negate(proof.C),
            vk.delta2,
            Pairing.negate(vk.alfa1),
            vk.beta2
        );
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool) {
        Proof memory proof;
        proof.A = Pairing.G1Point(a[0], a[1]);
        proof.B = Pairing.G2Point([b[0][0], b[0][1]], [b[1][0], b[1][1]]);
        proof.C = Pairing.G1Point(c[0], c[1]);

        uint256[] memory copiedInput = new uint256[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            copiedInput[i] = input[i];
        }

        return _verify(copiedInput, proof);
    }
}
