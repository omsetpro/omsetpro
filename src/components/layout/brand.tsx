import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="OmsetPro home">
      <span className="brand-mark" aria-hidden="true">
        RB
      </span>
      <span>OmsetPro</span>
    </Link>
  );
}

