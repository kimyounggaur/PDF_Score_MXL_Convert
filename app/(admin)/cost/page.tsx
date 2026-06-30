import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface DailyCostRow {
  date: string;
  total_jobs: number;
  total_cost_usd: number | string;
  sonnet_cost: number | string;
  opus_cost: number | string;
}

interface CostLogRow {
  id: string;
  created_at: string;
  job_id: string;
  page_num: number | null;
  model: string;
  cost_usd: number | string;
}

function money(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0);
  return `$${(Number.isFinite(parsed) ? parsed : 0).toFixed(4)}`;
}

async function loadCostDashboard(): Promise<{ daily: DailyCostRow[]; recent: CostLogRow[] }> {
  const supabase = getSupabaseAdmin();
  const [dailyResult, recentResult] = await Promise.all([
    supabase.from("daily_cost_summary").select("date,total_jobs,total_cost_usd,sonnet_cost,opus_cost").order("date", { ascending: false }).limit(30),
    supabase.from("api_cost_log").select("id,created_at,job_id,page_num,model,cost_usd").order("created_at", { ascending: false }).limit(25)
  ]);
  if (dailyResult.error) throw dailyResult.error;
  if (recentResult.error) throw recentResult.error;
  return {
    daily: (dailyResult.data ?? []) as DailyCostRow[],
    recent: (recentResult.data ?? []) as CostLogRow[]
  };
}

export default async function CostDashboardPage() {
  let dashboard: { daily: DailyCostRow[]; recent: CostLogRow[] };
  try {
    dashboard = await loadCostDashboard();
  } catch (error) {
    return (
      <main className="app-shell">
        <section className="panel section">
          <h1>비용 대시보드</h1>
          <p className="error">{error instanceof Error ? error.message : String(error)}</p>
          <Link className="button secondary" href="/">
            돌아가기
          </Link>
        </section>
      </main>
    );
  }

  const today = dashboard.daily[0];
  const total30d = dashboard.daily.reduce((sum, row) => sum + Number(row.total_cost_usd ?? 0), 0);
  const maxDaily = Math.max(0.0001, ...dashboard.daily.map((row) => Number(row.total_cost_usd ?? 0)));

  return (
    <main className="app-shell">
      <div className="job-shell">
        <section className="panel section">
          <div className="button-row">
            <h1 style={{ marginRight: "auto" }}>비용 대시보드</h1>
            <Link className="button secondary" href="/">
              메인
            </Link>
          </div>
          <div className="metric-grid">
            <div className="metric">
              <span className="muted">오늘 비용</span>
              <strong>{money(today?.total_cost_usd)}</strong>
            </div>
            <div className="metric">
              <span className="muted">오늘 작업</span>
              <strong>{today?.total_jobs ?? 0}</strong>
            </div>
            <div className="metric">
              <span className="muted">30일 비용</span>
              <strong>{money(total30d)}</strong>
            </div>
            <div className="metric">
              <span className="muted">최근 호출</span>
              <strong>{dashboard.recent.length}</strong>
            </div>
          </div>
        </section>

        <section className="panel section">
          <h2>최근 30일</h2>
          <div className="cost-chart">
            {dashboard.daily.map((row) => {
              const total = Number(row.total_cost_usd ?? 0);
              return (
                <div className="cost-chart-row" key={row.date}>
                  <span>{row.date}</span>
                  <div className="cost-chart-bar">
                    <span style={{ width: `${Math.max(3, (total / maxDaily) * 100)}%` }} />
                  </div>
                  <strong>{money(total)}</strong>
                </div>
              );
            })}
            {dashboard.daily.length === 0 ? <p className="muted">아직 집계된 비용이 없습니다.</p> : null}
          </div>
        </section>

        <section className="panel section">
          <h2>최근 호출</h2>
          <div className="admin-cost-log">
            {dashboard.recent.map((row) => (
              <div className="cost-log-row" key={row.id}>
                <span>{new Date(row.created_at).toLocaleString("ko-KR")}</span>
                <span>p{row.page_num ?? "-"}</span>
                <span>{row.model.includes("opus") ? "Opus" : "Sonnet"}</span>
                <strong>{money(row.cost_usd)}</strong>
              </div>
            ))}
            {dashboard.recent.length === 0 ? <p className="muted">아직 호출 로그가 없습니다.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
