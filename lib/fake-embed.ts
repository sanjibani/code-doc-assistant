// Deterministic fake embedding. Used when EMBED_FAKE=1 is set OR
// when the seed-demo script populates the DB without a real API.
//
// We hash the input text into a seed, then derive N-dim vector via
// sin(j * seed * 0.001). Same input -> same vector. Different inputs
// -> different vectors. Not semantically meaningful, but enough to
// make vector search return SOMETHING sensible for demos and
// screenshots when the real MiniMax endpoint is rate-limited.
//
// Exported separately so seed-demo.ts and lib/embed.ts share the
// same hashing function (otherwise query embedding and stored
// embedding would diverge and retrieval would return random hits).

export function fakeEmbedForSeed(text: string): number[] {
  const dim = Number(process.env.EMBEDDING_DIM ?? 1536);
  const v = new Array<number>(dim).fill(0);
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  for (let j = 0; j < dim; j++) {
    v[j] = Math.sin((j + 1) * (seed % 1000) * 0.001);
  }
  return v;
}