import { BENCHMARK, SECTOR_UNIVERSE } from "../../src/config/sectorUniverse.ts";
import { MARKET_CAP_SEGMENTS } from "../../src/config/marketCapSegments.ts";
import { MARKET_CONTEXT_INDICES } from "../../src/config/marketIndices.ts";
import { indexSetHash } from "./refresh-state.mts";

// MARKET_CAP_SEGMENTS includes NIFTY 500 again (as the self-benchmark entry) -
// excluded here since it's already covered by BENCHMARK, same slug/index name.
const NEW_SEGMENT_DEFS = MARKET_CAP_SEGMENTS.filter((s) => s.slug !== BENCHMARK.slug);

/**
 * Every series extracted from NSE's ind_close_all file. MARKET_CONTEXT_INDICES
 * (NIFTY 50) feed market context only. Adding an index changes INDEX_SET_HASH,
 * which re-extracts older dates in bounded batches (see planFetch).
 */
export const ALL_INDEX_DEFS: Array<{ slug: string; nseIndexName: string }> = [BENCHMARK, ...SECTOR_UNIVERSE, ...NEW_SEGMENT_DEFS, ...MARKET_CONTEXT_INDICES];
export const INDEX_SET_HASH = indexSetHash(ALL_INDEX_DEFS.map((d) => d.nseIndexName));
