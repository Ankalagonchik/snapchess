import { GameClient } from "@/components/GameClient";

export default function GamePage({ params }: { params: { id: string } }) {
  return <GameClient gameId={params.id} />;
}
