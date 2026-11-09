import { Fragment, type ReactNode } from "react";
import { formatNumber, stripSign } from "./format";

export function Star({ size = 16, className }: { size?: number; className?: string }) {
  return <img className={["star", className ?? ""].join(" ").trim()} src="/img/star.png" width={size} height={size} alt="" draggable={false} />;
}

export function Amount({
  value,
  sign,
  size = 16,
  className,
}: {
  value: string | number;
  sign?: "+" | "-";
  size?: number;
  className?: string;
}) {
  const text = String(value);
  const body = formatNumber(sign ? stripSign(text) : text);
  return (
    <span className={["amount", className ?? ""].join(" ").trim()}>
      {sign === "+" ? "+" : sign === "-" ? "−" : ""}
      {body}
      <Star size={size} />
    </span>
  );
}

export function withStars(text: string, size = 14): ReactNode {
  const parts = text.split("⭐");
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && <Star size={size} className="star-inline" />}
    </Fragment>
  ));
}
