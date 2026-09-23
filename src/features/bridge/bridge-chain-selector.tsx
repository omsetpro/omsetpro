import type { EVMChainDefinition } from "@circle-fin/bridge-kit";

export function BridgeChainSelector({
  id,
  label,
  value,
  chains,
  disabled,
  loading,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  chains: EVMChainDefinition[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (chainId: number) => void;
}) {
  return (
    <label className="bridge-chain-field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select
        id={id}
        value={chains.some((chain) => chain.chainId === value) ? value : ""}
        disabled={disabled || loading || chains.length === 0}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {!chains.some((chain) => chain.chainId === value) && (
          <option value="" disabled>
            {loading ? "Checking Circle routes…" : "Choose a supported network"}
          </option>
        )}
        {chains.map((chain) => (
          <option key={chain.chainId} value={chain.chainId}>
            {chain.title ?? chain.name}
          </option>
        ))}
      </select>
    </label>
  );
}
