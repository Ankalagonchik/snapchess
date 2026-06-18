import { ComputerGameClient } from "@/components/ComputerGameClient";

export default function ComputerPage({ searchParams }: { searchParams: { timeControl?: string } }) {
  return <ComputerGameClient timeControl={searchParams.timeControl} />;
}
