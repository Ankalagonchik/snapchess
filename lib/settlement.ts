import type { StoredGame } from "@/lib/types";
import { hasEscrowAutomation, transferFromEscrow } from "@/lib/hive";

const HOUSE_FEE_RATE = 0.04;
const HOUSE_FEE_MINIMUM = 0.002;

function amountOrZero(amount?: number) {
  return Number((amount || 0).toFixed(3));
}

export function getStakePot(game: StoredGame) {
  return amountOrZero(game.stake.amount * 2);
}

export function getHouseFeeFromPot(pot: number) {
  return amountOrZero(Math.max(pot * HOUSE_FEE_RATE, HOUSE_FEE_MINIMUM));
}

export function getStakeSettlementSummary(game: StoredGame) {
  const pot = getStakePot(game);
  const fee = getHouseFeeFromPot(pot);
  const payout = amountOrZero(Math.max(0, pot - fee));
  const winnerNet = amountOrZero(Math.max(0, payout - game.stake.amount));

  return { pot, fee, payout, winnerNet };
}

export async function settleAbortedGame(game: StoredGame) {
  if (game.stake.amount <= 0 || game.stake.settlementStatus === "refunded" || game.stake.settlementStatus === "manual") {
    return;
  }

  if (!game.stake.whiteConfirmed && !game.stake.blackConfirmed) {
    game.stake.settlementStatus = "refunded";
    game.stake.settlementMemo = "No stake transfers were confirmed.";
    return;
  }

  if (!hasEscrowAutomation()) {
    game.stake.settlementStatus = "manual";
    game.stake.settlementMemo = "Stake is held in escrow. Manual refund is required because ESCROW_ACTIVE_KEY is not configured.";
    return;
  }

  if (game.stake.whiteConfirmed && !game.stake.whiteRefundTxId) {
    game.stake.whiteRefundTxId = await transferFromEscrow({
      to: game.white,
      amount: game.stake.amount,
      memo: `refund:${game.id}:white`,
    });
  }

  if (game.black && game.stake.blackConfirmed && !game.stake.blackRefundTxId) {
    game.stake.blackRefundTxId = await transferFromEscrow({
      to: game.black,
      amount: game.stake.amount,
      memo: `refund:${game.id}:black`,
    });
  }

  game.stake.settlementStatus = "refunded";
  game.stake.settlementMemo = "Stake refunded to all funded players.";
}

export async function settleFinishedGame(game: StoredGame) {
  if (!game.result || game.stake.amount <= 0 || game.stake.settlementStatus === "paid" || game.stake.settlementStatus === "refunded" || game.stake.settlementStatus === "manual") {
    return;
  }

  if (game.result.winner === "draw") {
    await settleAbortedGame(game);
    return;
  }

  if (!hasEscrowAutomation()) {
    game.stake.settlementStatus = "manual";
    game.stake.settlementMemo = "Stake is held in escrow. Manual payout is required because ESCROW_ACTIVE_KEY is not configured.";
    return;
  }

  const winner = game.result.winner === "white" ? game.white : game.black;
  if (!winner) {
    return;
  }

  const { fee, payout } = getStakeSettlementSummary(game);
  game.stake.payoutTxId = await transferFromEscrow({
    to: winner,
    amount: payout,
    memo: `payout:${game.id}:${winner}`,
  });
  game.stake.settlementStatus = "paid";
  game.stake.settlementMemo = `Escrow paid ${payout.toFixed(3)} HIVE to @${winner} and retained ${fee.toFixed(3)} HIVE as the platform fee.`;
}
