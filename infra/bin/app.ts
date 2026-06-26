#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { SiteStack } from "../lib/site-stack";

interface Config {
  awsAccountId: string;
  awsRegion: string;
  domainName: string;
  siteHost: "apex" | "www";
  ownerEmail: string;
  googleClientId: string;
  siteTitle: string;
  siteDescription: string;
  apiOriginSecret: string;
}

function loadConfig(): Config {
  const root = path.join(__dirname, "..", "..");
  const file = path.join(root, "config.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing config.json at repo root. Copy config.example.json to config.json and fill it in.`,
    );
  }
  const cfg = JSON.parse(fs.readFileSync(file, "utf8")) as Config;
  for (const k of [
    "awsAccountId",
    "awsRegion",
    "domainName",
    "ownerEmail",
    "googleClientId",
    "apiOriginSecret",
  ] as const) {
    if (!cfg[k] || String(cfg[k]).includes("REPLACE")) {
      throw new Error(`config.json: "${k}" is not set`);
    }
  }
  // CloudFront requires its ACM cert in us-east-1, and we create the cert in
  // this same stack, so the whole stack must live in us-east-1.
  if (cfg.awsRegion !== "us-east-1") {
    throw new Error(
      `config.json: awsRegion must be "us-east-1" (CloudFront certificates ` +
        `must live there). Got "${cfg.awsRegion}".`,
    );
  }
  return cfg;
}

const cfg = loadConfig();

// --- SAFETY GUARD: never deploy into the wrong AWS account ---
// CDK_DEFAULT_ACCOUNT is the account of the credentials currently in use.
// If it doesn't match the account pinned in config.json, refuse to proceed so
// personal-site infra can never land in a client account by accident.
const activeAccount = process.env.CDK_DEFAULT_ACCOUNT;
if (activeAccount && activeAccount !== cfg.awsAccountId) {
  throw new Error(
    `Refusing to synth/deploy: active AWS account ${activeAccount} does not ` +
      `match config.json awsAccountId ${cfg.awsAccountId}. ` +
      `Switch to your personal account (check: aws sts get-caller-identity).`,
  );
}

const app = new cdk.App();

new SiteStack(app, "ThmPaintsSite", {
  // Pinning env to the configured account+region means a deploy with
  // credentials for any other account fails fast.
  env: { account: cfg.awsAccountId, region: cfg.awsRegion },
  domainName: cfg.domainName,
  siteHost: cfg.siteHost ?? "apex",
  ownerEmail: cfg.ownerEmail,
  googleClientId: cfg.googleClientId,
  siteTitle: cfg.siteTitle ?? "THM Paints",
  siteDescription: cfg.siteDescription ?? "",
  apiOriginSecret: cfg.apiOriginSecret,
});
