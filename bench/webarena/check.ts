const SHOPPING = process.env.SHOPPING_URL ?? "http://127.0.0.1:7770/";
const GITLAB = process.env.GITLAB_URL ?? "http://127.0.0.1:8023/users/sign_in";

async function status(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    return response.status;
  } catch {
    return 0;
  }
}

const [shopping, gitlab] = await Promise.all([status(SHOPPING), status(GITLAB)]);
const result = {
  shopping: { url: SHOPPING, status: shopping },
  gitlab: { url: GITLAB, status: gitlab },
};

console.log(JSON.stringify(result, null, 2));

const reachable = (code: number): boolean => code > 0 && code < 400;

if (!reachable(shopping) || !reachable(gitlab)) {
  console.error("one or both WebArena apps are not reachable; run pnpm webarena:reset");
  process.exit(1);
}
