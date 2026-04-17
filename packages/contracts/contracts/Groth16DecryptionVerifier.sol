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

contract Groth16DecryptionVerifier {
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
        vk.alfa1 = Pairing.G1Point(uint256(8570864111827923177585112290191085711586553229629075908027884713165281054910), uint256(8853833403283796195115815119846042728443471604183019173509903093421205343892));
        vk.beta2 = Pairing.G2Point([uint256(6479123866171402822486411329308393799769702862047233873209616501191758634099), uint256(6578157949543069015183036129745385216691686571655254893352338870851368937524)], [uint256(5150126997843793232227563105936962064946597508219198652349621307891921004864), uint256(16668822918639230703364417925947454530220404497943077917630802771544678520644)]);
        vk.gamma2 = Pairing.G2Point([uint256(2906170557849732534404493548713808686458016564915312769596376627106387803110), uint256(2845300593804229919420340546248466363083640873948234270096525845847662087312)], [uint256(2465939021572009273217272504834622425524837790523333582018711218044482823595), uint256(1175708896751946781413916273086101037135469992810559394848518076888847860038)]);
        vk.delta2 = Pairing.G2Point([uint256(20949466910838762388136303036761958656996734151807169370587465648392749958308), uint256(16725962028127837985220666915235852697007208740285358674486256173626073338726)], [uint256(377625825018789774419102260855479623866432738137860902951477965719820889627), uint256(5228441356823617085248478848051799341642864898892186134479466814362739934334)]);
        vk.IC = new Pairing.G1Point[](7);
        vk.IC[0] = Pairing.G1Point(uint256(13762679689248246688437682038336388017181704575671081260041532841982887716552), uint256(726196356804888619100302427165326279562074527397350806895105055708018619312));
        vk.IC[1] = Pairing.G1Point(uint256(8005402803347811387152358647104141964267165425161920351918564272850491299834), uint256(3208430173287658002559405132771387918743867980356777742665711494910630352781));
        vk.IC[2] = Pairing.G1Point(uint256(16843877782550942973319814272437732170105670152802059505021300723571149125500), uint256(21266820773796612285977737610185830802960475796313226613379446866911084237451));
        vk.IC[3] = Pairing.G1Point(uint256(7176169402930717468833839270899735536636502550051598091445874109730168355845), uint256(20149052240680797996382663147764974878949489703069081114319502122458041499840));
        vk.IC[4] = Pairing.G1Point(uint256(15170562000876707881649615924102301709730003354768196596932702073248774867518), uint256(17877929702916249646836023280257872805284904367626356070699097568218208948177));
        vk.IC[5] = Pairing.G1Point(uint256(18769689177104878428941610765241301747097796476123096026109070464140274696168), uint256(10320035158249134194561750714679866752023560962002926007750663209760556472948));
        vk.IC[6] = Pairing.G1Point(uint256(20147770308947375095941944957080738497088940840906651235457746914255982951079), uint256(18519165573015503456216227930057869830647154847889496994952783537951228949496));
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
