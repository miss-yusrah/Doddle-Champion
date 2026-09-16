import {
  concat, createPublicClient, createWalletClient, custom, encodeFunctionData,
  formatUnits, http, type Address, type Hex,
} from "viem";
import { celo } from "viem/chains";
import { codeFromHostname, toDataSuffix } from "@celo/attribution-tags";

/**
 * MiniPay / Celo wallet for Doodle Champion.
 *
 * Pattern mirrored from Mini-Rush's pre-Nimiq Celo build: zero-click inside
 * MiniPay, fail-soft tracker writes with USDm feeCurrency + ERC-8021
 * attribution. The game itself never depends on a wallet or a contract.
 */

/** USDm on Celo mainnet — balance reads and feeCurrency for tracker writes. */
const USDM: Address = "0x765DE816845861e75A25fCA122bb6898B8B1282a";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** DoodleChampionTracker. Empty / zero ⇒ on-chain tracking is off. */
const TRACKER: Address =
  ((import.meta.env.VITE_TRACKER_ADDRESS as string | undefined) as Address) || ZERO;

const trackingEnabled = (): boolean => TRACKER !== ZERO;

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TRACKER_ABI = [
  {
    name: "signUp",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "recordMatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "score", type: "uint32" },
      { name: "place", type: "uint16" },
      { name: "modeId", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "statsOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "matches", type: "uint32" },
      { name: "bestScore", type: "uint32" },
      { name: "lastPlayed", type: "uint64" },
    ],
  },
  {
    name: "totalPlayers",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalMatches",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface MatchRecord {
  score: number;
  /** 1 = win / clear, 2 = loss / fail, 0 = scored run with no win/loss. */
  place: number;
  modeId: number;
}

export interface PlayerStats {
  registered: boolean;
  matches: number;
  bestScore: number;
}

interface EthereumProvider {
  isMiniPay?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?(event: string, callback: (...args: unknown[]) => void): void;
}

function getProvider(): EthereumProvider | null {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
}

/** In-game alias — never show a raw 0x address as the primary identity. */
export function doodleAlias(address: string): string {
  return `INK ${address.slice(-4).toUpperCase()}`;
}

let attributionTag: Hex | null = null;
function suffix(): Hex {
  if (attributionTag) return attributionTag;
  attributionTag = toDataSuffix(codeFromHostname(window.location.hostname || "localhost")) as Hex;
  return attributionTag;
}

export class Wallet {
  address: Address | null = null;

  get available(): boolean {
    return getProvider() !== null;
  }

  get isMiniPay(): boolean {
    return getProvider()?.isMiniPay === true;
  }

  get trackingOn(): boolean {
    return trackingEnabled();
  }

  /** Quiet connect. Inside MiniPay there is no Connect button. */
  async connect(): Promise<Address | null> {
    const provider = getProvider();
    if (!provider) return null;
    try {
      const client = createWalletClient({ chain: celo, transport: custom(provider) });
      const [address] = await client.requestAddresses();
      this.address = address;
      return address;
    } catch {
      return null;
    }
  }

  alias(): string {
    if (!this.address) return this.isMiniPay ? "MINIPAY READY" : "GUEST";
    return doodleAlias(this.address);
  }

  /** Preferred stablecoin balance (USDm), or null if unavailable. */
  async stablecoinBalance(): Promise<string | null> {
    if (!this.address) return null;
    try {
      const provider = getProvider();
      const client = createPublicClient({
        chain: celo,
        transport: provider ? custom(provider) : http(),
      });
      const raw = await client.readContract({
        address: USDM,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.address],
      });
      return Number(formatUnits(raw, 18)).toFixed(2);
    } catch {
      return null;
    }
  }

  async signUp(): Promise<Hex | null> {
    return this.write(encodeFunctionData({ abi: TRACKER_ABI, functionName: "signUp" }));
  }

  /** Record a finished bout. Auto-registers on first write. Fails soft. */
  async recordMatch(run: MatchRecord): Promise<Hex | null> {
    const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
    return this.write(
      encodeFunctionData({
        abi: TRACKER_ABI,
        functionName: "recordMatch",
        args: [
          clamp(run.score, 0xffffffff),
          clamp(run.place, 0xffff),
          clamp(run.modeId, 0xffff),
        ],
      }),
    );
  }

  async stats(): Promise<PlayerStats | null> {
    if (!trackingEnabled() || !this.address) return null;
    try {
      const [registered, matches, bestScore] = await this.reader().readContract({
        address: TRACKER,
        abi: TRACKER_ABI,
        functionName: "statsOf",
        args: [this.address],
      });
      return { registered, matches: Number(matches), bestScore: Number(bestScore) };
    } catch {
      return null;
    }
  }

  async totals(): Promise<{ players: number; matches: number } | null> {
    if (!trackingEnabled()) return null;
    try {
      const client = this.reader();
      const [players, matches] = await Promise.all([
        client.readContract({ address: TRACKER, abi: TRACKER_ABI, functionName: "totalPlayers" }),
        client.readContract({ address: TRACKER, abi: TRACKER_ABI, functionName: "totalMatches" }),
      ]);
      return { players: Number(players), matches: Number(matches) };
    } catch {
      return null;
    }
  }

  private async write(callData: Hex, to: Address = TRACKER): Promise<Hex | null> {
    const provider = getProvider();
    if (to === ZERO || !this.address || !provider) return null;
    try {
      const client = createWalletClient({ chain: celo, transport: custom(provider) });
      return await client.sendTransaction({
        account: this.address,
        to,
        data: concat([callData, suffix()]),
        feeCurrency: USDM,
      });
    } catch {
      return null;
    }
  }

  private reader() {
    const provider = getProvider();
    return createPublicClient({
      chain: celo,
      transport: provider ? custom(provider) : http(),
    });
  }
}

/** Stable mode ids for the tracker — keep these fixed once shipped. */
export const MODE_CHAIN_ID: Record<string, number> = {
  duel: 0,
  siege: 1,
  endless: 2,
  glide: 3,
  samepage: 4,
  puppet: 5,
  monster: 6,
  volley: 7,
  bridge: 8,
  copycat: 9,
  hunt: 10,
};
