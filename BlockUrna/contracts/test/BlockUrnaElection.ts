import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("BlockUrnaElection", function () {
  async function deploy() {
    const [owner, voter1, voter2] = await ethers.getSigners();

    const initialParties = ["Partido Azul", "Partido Verde", "Partido Rojo"];
    const election = await ethers.deployContract(
      "BlockUrnaElection",
      [initialParties],
      owner,
    );

    return { election, owner, voter1, voter2, initialParties };
  }

  it("requires at least 3 parties", async function () {
    const ElectionFactory = await ethers.getContractFactory("BlockUrnaElection");

    await expect(ElectionFactory.deploy(["A", "B"]))
      .to.revert(ethers);
  });

  it("supports registration request + admin approval", async function () {
    const { election, owner, voter1 } = await deploy();

    await election.connect(owner).openRegistration();

    await election.connect(voter1).requestRegistration();
    expect(await election.voterStatus(voter1.address)).to.equal(1n); // Pending

    const pending1 = await election.getPendingVoters();
    expect(pending1).to.include(voter1.address);

    await election.connect(owner).approveVoter(voter1.address);
    expect(await election.voterStatus(voter1.address)).to.equal(2n); // Approved

    const pending2 = await election.getPendingVoters();
    expect(pending2).to.not.include(voter1.address);
  });

  it("counts votes and prevents double voting", async function () {
    const { election, owner, voter1, voter2 } = await deploy();

    await election.connect(owner).openRegistration();

    await election.connect(voter1).requestRegistration();
    await election.connect(voter2).requestRegistration();

    await election.connect(owner).approveVoter(voter1.address);

    await election.connect(owner).openVoting();

    await election.connect(voter1).vote(0);

    expect(await election.hasVoted(voter1.address)).to.equal(true);
    expect(await election.totalVotes()).to.equal(1n);

    const party0 = await election.parties(0);
    expect(party0.voteCount ?? party0[1]).to.equal(1n);

    await expect(election.connect(voter1).vote(0)).to.revert(ethers);
    await expect(election.connect(voter2).vote(1)).to.revert(ethers);
  });
});
