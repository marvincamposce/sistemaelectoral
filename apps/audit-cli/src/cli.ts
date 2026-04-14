#!/usr/bin/env node

import fs from "node:fs/promises";

import { Command } from "commander";
import { ethers } from "ethers";

import { verifyActaAnchoredOnChain, verifyActaFile } from "@blockurna/sdk";

const program = new Command();

program
  .name("blockurna-audit")
  .description("Audit CLI (BU-PVP-1): verificación de actas digitales y anclajes on-chain")
  .version("0.0.0");

program
  .command("verify-acta")
  .requiredOption("--file <path>", "Ruta al JSON del acta firmada (SignedSnapshot)")
  .option("--rpc <url>", "RPC URL para verificar anclaje on-chain")
  .option(
    "--contract <address>",
    "Dirección del BU_PVP_1_ElectionRegistry (TPE)",
  )
  .option("--election <id>", "ElectionId (uint256)")
  .action(async (opts) => {
    const raw = await fs.readFile(opts.file, "utf8");
    const json = JSON.parse(raw) as unknown;

    const local = await verifyActaFile(json);
    if (!local.ok) {
      console.error(JSON.stringify({ ok: false, step: "local", error: local.error }, null, 2));
      process.exitCode = 1;
      return;
    }

    const out: Record<string, unknown> = {
      ok: true,
      local: { ok: true, snapshotHashHex: local.snapshotHashHex },
    };

    if (opts.rpc && opts.contract && typeof opts.election === "string") {
      const provider = new ethers.JsonRpcProvider(opts.rpc);
      const electionId = Number(opts.election);
      const anchored = await verifyActaAnchoredOnChain({
        signedSnapshotJson: json,
        provider,
        electionRegistryAddress: opts.contract,
        electionId,
      });
      out.chain = anchored;
    }

    console.log(JSON.stringify(out, null, 2));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
