import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  getAddress,
  type Address,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
} from "viem";
import { foundry } from "viem/chains";
import { createTestClient } from "viem";
import { abi, bytecode } from "../src/index.js";

const TRANSPORT = http("http://127.0.0.1:8545");

function getClients() {
  const publicClient = createPublicClient({
    chain: foundry,
    transport: TRANSPORT,
  });

  const walletClient = createWalletClient({
    chain: foundry,
    transport: TRANSPORT,
  });

  const testClient = createTestClient({
    chain: foundry,
    transport: TRANSPORT,
    mode: "anvil",
  });

  return { publicClient, walletClient, testClient };
}

async function deployToken(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  params: {
    name: string;
    symbol: string;
    initialSupply: bigint;
    cap: bigint;
    mintingEnabled: boolean;
    owner: Address;
  },
): Promise<Address> {
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    account: params.owner,
    args: [
      params.name,
      params.symbol,
      params.initialSupply,
      params.cap,
      params.mintingEnabled,
      params.owner,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("Contract deployment failed");
  }
  return getAddress(receipt.contractAddress);
}

describe("ERC20Token", () => {
  let publicClient: PublicClient<Transport, Chain>;
  let walletClient: WalletClient<Transport, Chain>;
  let owner: Address;
  let other: Address;

  beforeAll(async () => {
    const clients = getClients();
    publicClient = clients.publicClient;
    walletClient = clients.walletClient;

    const accounts = await walletClient.getAddresses();
    owner = accounts[0]!;
    other = accounts[1]!;
  });

  describe("basic ERC20 functions", () => {
    let token: Address;

    beforeAll(async () => {
      token = await deployToken(publicClient, walletClient, {
        name: "TestToken",
        symbol: "TT",
        initialSupply: parseEther("1000"),
        cap: parseEther("10000"),
        mintingEnabled: true,
        owner,
      });
    });

    it("returns correct name", async () => {
      const name = await publicClient.readContract({
        address: token,
        abi,
        functionName: "name",
      });
      expect(name).toBe("TestToken");
    });

    it("returns correct symbol", async () => {
      const symbol = await publicClient.readContract({
        address: token,
        abi,
        functionName: "symbol",
      });
      expect(symbol).toBe("TT");
    });

    it("returns 18 decimals", async () => {
      const decimals = await publicClient.readContract({
        address: token,
        abi,
        functionName: "decimals",
      });
      expect(decimals).toBe(18);
    });

    it("returns correct totalSupply", async () => {
      const totalSupply = await publicClient.readContract({
        address: token,
        abi,
        functionName: "totalSupply",
      });
      expect(totalSupply).toBe(parseEther("1000"));
    });

    it("transfers tokens between accounts", async () => {
      const amount = parseEther("100");

      const hash = await walletClient.writeContract({
        address: token,
        abi,
        functionName: "transfer",
        args: [other, amount],
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const balance = await publicClient.readContract({
        address: token,
        abi,
        functionName: "balanceOf",
        args: [other],
      });
      expect(balance).toBe(amount);
    });
  });

  describe("minting", () => {
    it("allows owner to mint when enabled", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "MintToken",
        symbol: "MT",
        initialSupply: parseEther("100"),
        cap: parseEther("10000"),
        mintingEnabled: true,
        owner,
      });

      const hash = await walletClient.writeContract({
        address: token,
        abi,
        functionName: "mint",
        args: [other, parseEther("50")],
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const balance = await publicClient.readContract({
        address: token,
        abi,
        functionName: "balanceOf",
        args: [other],
      });
      expect(balance).toBe(parseEther("50"));
    });

    it("reverts minting when disabled", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "NoMintToken",
        symbol: "NMT",
        initialSupply: parseEther("100"),
        cap: parseEther("10000"),
        mintingEnabled: false,
        owner,
      });

      await expect(
        walletClient.writeContract({
          address: token,
          abi,
          functionName: "mint",
          args: [other, parseEther("50")],
          account: owner,
        }),
      ).rejects.toThrow();
    });
  });

  describe("burning", () => {
    it("allows token holder to burn their tokens", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "BurnToken",
        symbol: "BT",
        initialSupply: parseEther("1000"),
        cap: parseEther("10000"),
        mintingEnabled: false,
        owner,
      });

      const hash = await walletClient.writeContract({
        address: token,
        abi,
        functionName: "burn",
        args: [parseEther("200")],
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const balance = await publicClient.readContract({
        address: token,
        abi,
        functionName: "balanceOf",
        args: [owner],
      });
      expect(balance).toBe(parseEther("800"));
    });
  });

  describe("pause/unpause", () => {
    it("owner can pause and unpause transfers", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "PauseToken",
        symbol: "PT",
        initialSupply: parseEther("1000"),
        cap: parseEther("10000"),
        mintingEnabled: false,
        owner,
      });

      // Pause
      const pauseHash = await walletClient.writeContract({
        address: token,
        abi,
        functionName: "pause",
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash: pauseHash });

      // Transfer should fail while paused
      await expect(
        walletClient.writeContract({
          address: token,
          abi,
          functionName: "transfer",
          args: [other, parseEther("10")],
          account: owner,
        }),
      ).rejects.toThrow();

      // Unpause
      const unpauseHash = await walletClient.writeContract({
        address: token,
        abi,
        functionName: "unpause",
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash: unpauseHash });

      // Transfer should succeed after unpause
      const transferHash = await walletClient.writeContract({
        address: token,
        abi,
        functionName: "transfer",
        args: [other, parseEther("10")],
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      const balance = await publicClient.readContract({
        address: token,
        abi,
        functionName: "balanceOf",
        args: [other],
      });
      expect(balance).toBe(parseEther("10"));
    });
  });

  describe("cap enforcement", () => {
    it("reverts when minting beyond cap", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "CapToken",
        symbol: "CT",
        initialSupply: parseEther("900"),
        cap: parseEther("1000"),
        mintingEnabled: true,
        owner,
      });

      // Minting 200 should exceed cap of 1000 (already has 900)
      await expect(
        walletClient.writeContract({
          address: token,
          abi,
          functionName: "mint",
          args: [owner, parseEther("200")],
          account: owner,
        }),
      ).rejects.toThrow();
    });
  });

  describe("access control", () => {
    it("non-owner cannot mint", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "ACToken",
        symbol: "ACT",
        initialSupply: parseEther("100"),
        cap: parseEther("10000"),
        mintingEnabled: true,
        owner,
      });

      await expect(
        walletClient.writeContract({
          address: token,
          abi,
          functionName: "mint",
          args: [other, parseEther("50")],
          account: other,
        }),
      ).rejects.toThrow();
    });

    it("non-owner cannot pause", async () => {
      const token = await deployToken(publicClient, walletClient, {
        name: "ACToken2",
        symbol: "ACT2",
        initialSupply: parseEther("100"),
        cap: parseEther("10000"),
        mintingEnabled: false,
        owner,
      });

      await expect(
        walletClient.writeContract({
          address: token,
          abi,
          functionName: "pause",
          account: other,
        }),
      ).rejects.toThrow();
    });
  });
});
