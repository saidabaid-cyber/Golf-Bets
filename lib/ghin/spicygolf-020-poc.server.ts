const FIREBASE_SESSION_URL =
  "https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations";
const GHIN_BASE_URL = "https://api2.ghin.com/api/v1";
const TARGET_GHIN = "11103349";

// Public browser configuration copied from @spicygolf/ghin@0.20.0
// (npm gitHead 07f458391b04d22df9f647b5c3c4d634fba1458a).
const GOOGLE_API_KEY = "AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";
const SESSION_DEFAULTS = {
  appId: "1:884417644529:web:47fb315bc6c70242f72650",
  authVersion: "FIS_v2",
  fid: "fg6JfS0U01YmrelthLX9Iz",
  sdkVersion: "w:0.5.7",
} as const;

const FETCH_HEADER_DEFAULTS = {
  "Content-Type": "application/json",
  "User-Agent": DEFAULT_USER_AGENT,
} as const;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

type StageResult = {
  status: "PASS" | "FAIL" | "NOT_TESTED";
  httpStatus: number | null;
};

export type SpicyGhin020PocResult = {
  source: {
    package: "@spicygolf/ghin";
    version: "0.20.0";
    gitHead: "07f458391b04d22df9f647b5c3c4d634fba1458a";
  };
  checkedAt: string;
  firebaseSession: StageResult & { authTokenReceived: boolean };
  golferLogin: StageResult & { golferUserTokenReceived: boolean };
  golferLookup: StageResult & {
    matched: boolean;
    data: {
      name: string | null;
      ghin: string | null;
      club: string | null;
      homeClub: string | null;
      handicapIndex: string | number | null;
      status: string | null;
      revDate: string | null;
    } | null;
  };
  scoresReadOnly: StageResult & {
    count: number | null;
    totalCount: number | null;
    structuralFields: string[];
  };
  safety: {
    readOnly: true;
    scorePostingCalls: 0;
    secretsReturned: false;
  };
};

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringOrNumber(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return stringValue(value);
}

function ghinValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function fullName(golfer: JsonRecord): string | null {
  const parts = [golfer.first_name, golfer.middle_name, golfer.last_name]
    .map(stringValue)
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : null;
}

function blankResult(): SpicyGhin020PocResult {
  return {
    source: {
      package: "@spicygolf/ghin",
      version: "0.20.0",
      gitHead: "07f458391b04d22df9f647b5c3c4d634fba1458a",
    },
    checkedAt: new Date().toISOString(),
    firebaseSession: { status: "NOT_TESTED", httpStatus: null, authTokenReceived: false },
    golferLogin: { status: "NOT_TESTED", httpStatus: null, golferUserTokenReceived: false },
    golferLookup: { status: "NOT_TESTED", httpStatus: null, matched: false, data: null },
    scoresReadOnly: {
      status: "NOT_TESTED",
      httpStatus: null,
      count: null,
      totalCount: null,
      structuralFields: [],
    },
    safety: { readOnly: true, scorePostingCalls: 0, secretsReturned: false },
  };
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function scoreStructure(scores: unknown[]): string[] {
  const first = record(scores[0]);
  if (!first) return [];
  const allowed = [
    "id",
    "played_at",
    "posted_at",
    "course_id",
    "course_name",
    "facility_name",
    "tee_set_id",
    "tee_name",
    "adjusted_gross_score",
    "differential",
    "course_rating",
    "slope_rating",
    "score_type",
    "score_type_display_full",
    "posting_method",
    "number_of_holes",
    "status",
  ];
  return allowed.filter((key) => Object.hasOwn(first, key));
}

/**
 * Reproduces the normal-golfer authentication and read-only calls implemented by
 * @spicygolf/ghin@0.20.0. Tokens remain local variables and are never returned.
 */
export async function runSpicyGhin020ReadOnlyPoc(options: {
  login: string;
  password: string;
  fetchImpl?: FetchLike;
}): Promise<SpicyGhin020PocResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const result = blankResult();

  const firebaseResponse = await fetchImpl(FIREBASE_SESSION_URL, {
    body: JSON.stringify(SESSION_DEFAULTS),
    headers: {
      ...FETCH_HEADER_DEFAULTS,
      "x-goog-api-key": GOOGLE_API_KEY,
    },
    method: "POST",
  });
  const firebasePayload = record(await responsePayload(firebaseResponse));
  const firebaseAuthToken = record(firebasePayload?.authToken);
  const firebaseToken = stringValue(firebaseAuthToken?.token);
  result.firebaseSession = {
    status: firebaseResponse.ok && firebaseToken ? "PASS" : "FAIL",
    httpStatus: firebaseResponse.status,
    authTokenReceived: Boolean(firebaseToken),
  };
  if (!firebaseResponse.ok || !firebaseToken) return result;

  const loginResponse = await fetchImpl(`${GHIN_BASE_URL}/golfer_login.json`, {
    body: JSON.stringify({
      token: firebaseToken,
      user: {
        email_or_ghin: options.login,
        password: options.password,
      },
    }),
    headers: FETCH_HEADER_DEFAULTS,
    method: "POST",
  });
  const loginPayload = record(await responsePayload(loginResponse));
  const golferUser = record(loginPayload?.golfer_user);
  const golferUserToken = stringValue(golferUser?.golfer_user_token);
  result.golferLogin = {
    status: loginResponse.ok && golferUserToken ? "PASS" : "FAIL",
    httpStatus: loginResponse.status,
    golferUserTokenReceived: Boolean(golferUserToken),
  };
  if (!loginResponse.ok || !golferUserToken) return result;

  const authHeaders = {
    ...FETCH_HEADER_DEFAULTS,
    Authorization: `Bearer ${golferUserToken}`,
  };
  const golferUrl = new URL(`${GHIN_BASE_URL}/golfers/search.json`);
  golferUrl.searchParams.set("page", "1");
  golferUrl.searchParams.set("per_page", "100");
  golferUrl.searchParams.set("sorting_criteria", "last_name_first_name");
  golferUrl.searchParams.set("order", "asc");
  golferUrl.searchParams.set("golfer_id", TARGET_GHIN);

  const golferResponse = await fetchImpl(golferUrl, { headers: authHeaders });
  const golferPayload = record(await responsePayload(golferResponse));
  const golfers = Array.isArray(golferPayload?.golfers)
    ? golferPayload.golfers.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
  const ownRows = golfers.filter((golfer) => ghinValue(golfer.ghin) === TARGET_GHIN);
  const homeRow = ownRows.find((golfer) => golfer.is_home_club === true) ?? null;
  const selected = homeRow ?? ownRows[0] ?? null;
  result.golferLookup = {
    status: golferResponse.ok && selected ? "PASS" : "FAIL",
    httpStatus: golferResponse.status,
    matched: Boolean(selected),
    data: selected
      ? {
          name: fullName(selected),
          ghin: ghinValue(selected.ghin),
          club: stringValue(selected.club_name),
          homeClub: stringValue(homeRow?.club_name),
          handicapIndex:
            stringOrNumber(selected.hi_display)
            ?? stringOrNumber(selected.handicap_index)
            ?? stringOrNumber(selected.hi_value),
          status: stringValue(selected.status),
          revDate: stringValue(selected.rev_date),
        }
      : null,
  };
  if (!golferResponse.ok || !selected) return result;

  const scoresUrl = new URL(`${GHIN_BASE_URL}/scores.json`);
  scoresUrl.searchParams.set("golfer_id", TARGET_GHIN);
  const scoresResponse = await fetchImpl(scoresUrl, { headers: authHeaders });
  const scoresPayload = record(await responsePayload(scoresResponse));
  const scores = Array.isArray(scoresPayload?.scores) ? scoresPayload.scores : null;
  result.scoresReadOnly = {
    status: scoresResponse.ok && scores ? "PASS" : "FAIL",
    httpStatus: scoresResponse.status,
    count: scores?.length ?? null,
    totalCount: typeof scoresPayload?.total_count === "number" ? scoresPayload.total_count : null,
    structuralFields: scores ? scoreStructure(scores) : [],
  };

  return result;
}
