// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Pairing {
    uint256 internal constant PRIME_Q =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

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
        vk.alfa1 = Pairing.G1Point(uint256(17380612535689319622578117622353031077328448144071188654723534495407209832613), uint256(6617400046179317210867954308160576466788917698371518468902531380396748874990));
        vk.beta2 = Pairing.G2Point([uint256(362206164232628520042775701562862054572983942197036861893195142929238173438), uint256(20310758851763089608097302028493645325219755429375202551554507870364908999892)], [uint256(4140265887576768936658808618044122767675877710630111037541525702109801752433), uint256(21497786192344075518984139990754408503200576093018892411312901491246258575710)]);
        vk.gamma2 = Pairing.G2Point([uint256(5939213018749121067405605157850295721182403898717333896129607110841877804763), uint256(18164835735106198659138569109685755918734235999276277874232809412465311498719)], [uint256(18408386810963949336210036834224181227460490687765352712364377130824446476531), uint256(16971971423998628739399213362663926766637220139212819212098895565110535696253)]);
        vk.delta2 = Pairing.G2Point([uint256(8218718185354565129758714075604783306512068630654309881624354889531341376658), uint256(19942497481492684923301943218074831803190683129889217956346537484757250615876)], [uint256(17117273525177146627904280360574916501917405090996619116994213015293948360917), uint256(2163690115200383983528603963804864603635375254726133647994387687962974334558)]);
        vk.IC = new Pairing.G1Point[](7);
        vk.IC[0] = Pairing.G1Point(uint256(8570585344663727674545985657152554306159955154184187789863883635779793560532), uint256(12857400653029606866397770494604672374231259578074558484229798381282641982255));
        vk.IC[1] = Pairing.G1Point(uint256(20634463634298365391993338224722708403693309775630918423850818577496327379963), uint256(16713496096254075843196291993362442432188266613826050366728768546053740004881));
        vk.IC[2] = Pairing.G1Point(uint256(12947174057210265822482015353951839196001297620020649129536643497772160158289), uint256(3845378378282681046459102043622817599210280352663812374817775516251955819481));
        vk.IC[3] = Pairing.G1Point(uint256(10630126996152760186608921615034400030198916798180065610224050470979372190295), uint256(15615234211073711242383220117034940591982487624191200009328499569649431570077));
        vk.IC[4] = Pairing.G1Point(uint256(8251962361566396791752913632815801210741082807875378046500240169831866038319), uint256(5931489000297873971450320512839731559077260698544797664191065742241307636460));
        vk.IC[5] = Pairing.G1Point(uint256(18337469097122019348345242875474235741892705523461494257668205716486037249128), uint256(3596612957087955518846044242435564023447972378797777912283713291277907998156));
        vk.IC[6] = Pairing.G1Point(uint256(10866656838483178528377915577685854791279455529344318279030500228554575868103), uint256(17220779610387605812930058394259839052646045859711719343256616347960425250551));
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
