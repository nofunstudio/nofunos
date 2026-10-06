// Custom-TSX example: an interactive print-vendor comparison with a working filter. Imports only
// `react` and `@nofun/artifacts`, like every custom artifact. Example data, not real quotes.
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Stack,
  Status,
  Text,
  cn,
} from "@nofun/artifacts";

type Vendor = {
  name: string;
  method: "Screen print" | "DTG" | "Embroidery";
  unitCost: number;
  minimum: number;
  turnaroundDays: number;
  rating: number;
  status: "Preferred" | "Trial" | "Paused";
  note: string;
};

const VENDORS: Vendor[] = [
  {
    name: "Northside Ink",
    method: "Screen print",
    unitCost: 6.4,
    minimum: 48,
    turnaroundDays: 9,
    rating: 4.8,
    status: "Preferred",
    note: "Best per-unit price above 100 pieces.",
  },
  {
    name: "Pixel Press",
    method: "DTG",
    unitCost: 11.2,
    minimum: 1,
    turnaroundDays: 3,
    rating: 4.5,
    status: "Preferred",
    note: "No minimum; good for drops under 50.",
  },
  {
    name: "Thread Theory",
    method: "Embroidery",
    unitCost: 9.8,
    minimum: 24,
    turnaroundDays: 12,
    rating: 4.7,
    status: "Trial",
    note: "Caps and hoodies; digitizing fee per logo.",
  },
  {
    name: "Loop Lab",
    method: "DTG",
    unitCost: 9.6,
    minimum: 12,
    turnaroundDays: 5,
    rating: 4.1,
    status: "Trial",
    note: "Cheaper DTG, slower color matching.",
  },
  {
    name: "Halftone House",
    method: "Screen print",
    unitCost: 7.1,
    minimum: 24,
    turnaroundDays: 7,
    rating: 4.3,
    status: "Paused",
    note: "Paused after a late October run.",
  },
  {
    name: "Stitch & Co",
    method: "Embroidery",
    unitCost: 12.5,
    minimum: 6,
    turnaroundDays: 6,
    rating: 4.6,
    status: "Preferred",
    note: "Small embroidery batches, fast.",
  },
];

const METHODS = ["All", "Screen print", "DTG", "Embroidery"] as const;
const TONE = { Preferred: "success", Trial: "info", Paused: "neutral" } as const;
const SORTS = { unitCost: "Lowest cost", turnaroundDays: "Fastest", rating: "Best rated" } as const;

export default function VendorComparison() {
  const [method, setMethod] = useState<(typeof METHODS)[number]>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("unitCost");
  const [quantity, setQuantity] = useState(60);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return VENDORS.filter((v) => method === "All" || v.method === method)
      .filter((v) => !needle || `${v.name} ${v.note}`.toLowerCase().includes(needle))
      .toSorted((a, b) => (sort === "rating" ? b.rating - a.rating : a[sort] - b[sort]));
  }, [method, query, sort]);

  const best = shown.find((v) => v.status !== "Paused" && quantity >= v.minimum);

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Text variant="micro" text="Example data · print vendors" />
        <Text variant="title" text="Who should print the next drop?" />
        <Text
          variant="muted"
          text="Filter by method, search notes, and set the run size to see which vendors qualify."
        />
      </Stack>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Print method">
          {METHODS.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={method === m ? "default" : "outline"}
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        <label className="grid min-w-44 flex-1 gap-1 text-xs text-muted-foreground">
          Search
          <Input
            type="search"
            value={query}
            placeholder="Name or note"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="grid w-28 gap-1 text-xs text-muted-foreground">
          Run size
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">
          {shown.length} of {VENDORS.length} vendors
          {best ? (
            <>
              {" · "}best fit for {quantity}:{" "}
              <span className="font-semibold text-foreground">{best.name}</span>
            </>
          ) : null}
        </span>
        <div className="flex gap-1" role="group" aria-label="Sort">
          {(Object.keys(SORTS) as Array<keyof typeof SORTS>).map((key) => (
            <Button
              key={key}
              size="xs"
              variant={sort === key ? "secondary" : "ghost"}
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
            >
              {SORTS[key]}
            </Button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No vendor matches. Clear the search or pick another method.
          </CardContent>
        </Card>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 15rem), 1fr))" }}
        >
          {shown.map((v) => {
            const qualifies = quantity >= v.minimum && v.status !== "Paused";
            return (
              <Card
                key={v.name}
                className={cn(
                  !qualifies && "opacity-60",
                  best?.name === v.name && "ring-2 ring-foreground/40",
                )}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {v.name}
                    {best?.name === v.name ? <Badge size="sm">Best fit</Badge> : null}
                  </CardTitle>
                  <CardDescription>{v.method}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <dl className="m-0 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="micro text-[0.66rem] text-muted-foreground">Unit</dt>
                      <dd className="m-0 font-medium tabular-nums">${v.unitCost.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="micro text-[0.66rem] text-muted-foreground">Min</dt>
                      <dd className="m-0 font-medium tabular-nums">{v.minimum}</dd>
                    </div>
                    <div>
                      <dt className="micro text-[0.66rem] text-muted-foreground">Days</dt>
                      <dd className="m-0 font-medium tabular-nums">{v.turnaroundDays}</dd>
                    </div>
                  </dl>
                  <p className="m-0 text-sm text-muted-foreground">{v.note}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Status label={v.status} tone={TONE[v.status]} size="sm" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {qualifies
                        ? `$${(v.unitCost * quantity).toLocaleString("en-US", { maximumFractionDigits: 0 })} total`
                        : `needs ${v.minimum}+`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Stack>
  );
}
