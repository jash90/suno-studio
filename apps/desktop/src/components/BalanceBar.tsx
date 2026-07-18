import { ReactNode } from "react";
import { CircleDollarSign, Coins, RefreshCw } from "lucide-react";
import { Balances } from "../types";

interface Props {
  balances: Balances;
  refreshing: boolean;
  onRefresh: () => void;
}

function fmt(value: number | null | undefined, prefix = "", suffix = ""): string {
  if (value === null) return "—";
  if (value === undefined) return "";
  return `${prefix}${value.toFixed(2).replace(/\.00$/, "")}${suffix}`;
}

/** Plakietki sald na górnym pasku; kliknięcie odświeża wszystkie. */
export default function BalanceBar({ balances, refreshing, onRefresh }: Props) {
  const items: { key: string; icon: ReactNode; label: string; title: string }[] = [];
  if (balances.suno !== undefined) {
    items.push({
      key: "suno",
      icon: <Coins size={13} />,
      label: `Suno: ${fmt(balances.suno)}`,
      title: balances.suno === null ? "Nie udało się pobrać kredytów Suno" : "Pozostałe kredyty Suno",
    });
  }
  if (balances.anthropic !== undefined) {
    items.push({
      key: "anthropic",
      icon: <CircleDollarSign size={13} />,
      label: `Anthropic: ${fmt(balances.anthropic, "$")}`,
      title:
        balances.anthropic === null
          ? "Błąd pobierania (sprawdź klucz admin sk-ant-admin...)"
          : "Wydatki Anthropic w tym miesiącu",
    });
  }
  if (balances.openai !== undefined) {
    items.push({
      key: "openai",
      icon: <CircleDollarSign size={13} />,
      label: `OpenAI: ${fmt(balances.openai, "$")}`,
      title:
        balances.openai === null
          ? "Błąd pobierania (sprawdź klucz admin z uprawnieniem api.usage.read)"
          : "Wydatki OpenAI w tym miesiącu",
    });
  }
  if (items.length === 0) return null;

  return (
    <div className="balance-bar" onClick={onRefresh} title="Kliknij, aby odświeżyć">
      {items.map((item) => (
        <span key={item.key} className="balance-chip" title={item.title}>
          {item.icon} {item.label}
        </span>
      ))}
      <RefreshCw size={12} className={refreshing ? "spin" : "balance-refresh"} />
    </div>
  );
}
