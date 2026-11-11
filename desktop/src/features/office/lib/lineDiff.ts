// A line diff (longest common subsequence) for the change viewer: which
// lines of `a` were removed and which of `b` were added, in order.

export type DiffLine = { kind: "same" | "add" | "remove"; text: string; /** line number in the new (or, for removed, old) text */ n: number };

export function lineDiff(a: string, b: string, max = 1500): DiffLine[] {
  const A = a === "" ? [] : a.replace(/\n$/, "").split("\n");
  const B = b === "" ? [] : b.replace(/\n$/, "").split("\n");
  // trim what's the same at both ends (most edits are local)
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const a2 = A.slice(head, A.length - tail);
  const b2 = B.slice(head, B.length - tail);
  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) out.push({ kind: "same", text: A[i], n: i + 1 });
  if (a2.length > max || b2.length > max) {
    // too big to align line by line: all out, all in
    a2.forEach((t, i) => out.push({ kind: "remove", text: t, n: head + i + 1 }));
    b2.forEach((t, i) => out.push({ kind: "add", text: t, n: head + i + 1 }));
  } else {
    const n = a2.length, m = b2.length;
    const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) {
        out.push({ kind: "same", text: a2[i], n: head + j + 1 });
        i++; j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ kind: "remove", text: a2[i], n: head + ++i });
      else out.push({ kind: "add", text: b2[j], n: head + ++j });
    }
    while (i < n) out.push({ kind: "remove", text: a2[i], n: head + ++i });
    while (j < m) out.push({ kind: "add", text: b2[j], n: head + ++j });
  }
  for (let k = 0; k < tail; k++) out.push({ kind: "same", text: B[B.length - tail + k], n: B.length - tail + k + 1 });
  return out;
}

/** Keep changed lines with `context` lines around them; gaps become null. */
export function foldDiff(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.kind !== "same") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
  });
  const out: (DiffLine | null)[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (keep[i]) {
      out.push(l);
      gap = false;
    } else if (!gap) {
      out.push(null);
      gap = true;
    }
  });
  return out;
}
