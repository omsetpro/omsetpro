import Image from "next/image";
import Link from "next/link";
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="OmsetPro home">
      <span className="brand-mark" aria-hidden="true">
        <Image
          src="/brand/omsetpro-logo.png"
          alt=""
          width={38}
          height={38}
          priority
        />
      </span>

      <span className="brand-copy">
        <strong>OmsetPro</strong>
        <small>Asset-backed agreements</small>
      </span>
    </Link>
  );
}