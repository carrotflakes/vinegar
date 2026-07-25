import { normalizeHex } from "@/model/color";

interface Props {
  /** Current colour as `#rrggbb`; shown without the leading `#`. */
  value: string;
  onChange: (hex: string) => void;
}

/** Text entry for a hex colour. Commits on Enter or blur, and silently reverts
 * when what was typed isn't a colour. */
export default function HexInput({ value, onChange }: Props) {
  return (
    <input
      // Remount on an external change so the field follows the picker.
      key={value}
      className="hex-input"
      defaultValue={value.replace("#", "")}
      placeholder="rrggbb"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const n = normalizeHex(e.target.value);
        if (n) onChange(n);
      }}
    />
  );
}
